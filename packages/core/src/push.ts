import webpush from 'web-push';
import { db } from '@rook/db';

/**
 * Web push — "your portfolio moved" is the daily-open loop's strongest
 * lever (§25). VAPID keys come from env in production; in dev they're
 * generated once and persisted in the versioned config table.
 */

export interface Vapid {
  publicKey: string;
  privateKey: string;
}

export async function getVapid(now: Date): Promise<Vapid> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const sql = db();
  const rows = await sql`
    select value from config where key = 'push' and effective_at <= ${now}
    order by effective_at desc limit 1
  `;
  const stored = rows[0]?.value as Vapid | undefined;
  if (stored?.publicKey) return stored;
  const keys = webpush.generateVAPIDKeys();
  await sql`insert into config (key, value, effective_at)
    values ('push', ${sql.json({ publicKey: keys.publicKey, privateKey: keys.privateKey })}, ${now})`;
  return keys;
}

export async function saveSubscription(
  userId: number,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  await db()`
    insert into push_subscriptions (endpoint, user_id, p256dh, auth)
    values (${sub.endpoint}, ${userId}, ${sub.keys.p256dh}, ${sub.keys.auth})
    on conflict (endpoint) do update set user_id = ${userId},
      p256dh = ${sub.keys.p256dh}, auth = ${sub.keys.auth}
  `;
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db()`delete from push_subscriptions where endpoint = ${endpoint}`;
}

const MOVE_THRESHOLD = 0.01;
const COOLDOWN_MS = 20 * 3600e3;

/**
 * Push tick: notify subscribed users whose portfolio moved ≥1% over the
 * last 24h, at most once per cooldown. Dead endpoints are pruned.
 */
export async function pushTick(seasonId: number, now: Date): Promise<{ sent: number }> {
  const sql = db();
  const vapid = await getVapid(now);
  webpush.setVapidDetails('mailto:hello@rook.ai', vapid.publicKey, vapid.privateKey);

  const subs = await sql`
    select ps.endpoint, ps.p256dh, ps.auth, ps.user_id, ps.last_notified_at
    from push_subscriptions ps
    where ps.last_notified_at is null or ps.last_notified_at < ${new Date(now.getTime() - COOLDOWN_MS)}
  `;
  let sent = 0;
  for (const s of subs) {
    // 24h portfolio move, marked against snapshots (cash is move-neutral)
    const [row] = await sql`
      with pos as (
        select h.asset_id, h.qty, a.p0 + a.m * a.supply as price_now
        from holdings h join assets a on a.id = h.asset_id
        where h.user_id = ${s.user_id} and a.season_id = ${seasonId} and h.qty > 1e-9
      ), past as (
        select p.asset_id, p.price
        from price_points p
        join (select asset_id, max(ts) as ts from price_points
              where ts <= ${new Date(now.getTime() - 86400e3)} group by asset_id) m
          on m.asset_id = p.asset_id and m.ts = p.ts
      )
      select coalesce(sum(pos.qty * pos.price_now), 0) as now_value,
             coalesce(sum(pos.qty * coalesce(past.price, pos.price_now)), 0) as past_value,
             (select cash from balances where user_id = ${s.user_id} and season_id = ${seasonId}) as cash
      from pos left join past on past.asset_id = pos.asset_id
    `;
    if (!row || row.cash === null) continue;
    const nowTotal = row.now_value + row.cash;
    const pastTotal = row.past_value + row.cash;
    if (pastTotal <= 0) continue;
    const move = nowTotal / pastTotal - 1;
    if (Math.abs(move) < MOVE_THRESHOLD) continue;

    const pct = (100 * Math.abs(move)).toFixed(1);
    const payload = JSON.stringify({
      title: `Your portfolio ${move >= 0 ? 'is up' : 'is down'} ${pct}% today`,
      body: move >= 0 ? 'Someone on the leaderboard noticed too.' : 'The market moved — see why.',
      url: '/',
    });
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      await sql`update push_subscriptions set last_notified_at = ${now} where endpoint = ${s.endpoint}`;
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await removeSubscription(s.endpoint);
    }
  }
  return { sent };
}
