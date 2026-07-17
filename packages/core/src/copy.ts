import { db } from '@rook/db';
import { loadConfig } from './config.js';
import { executeUserTrade } from './orders.js';
import { TradeRejected } from './trade.js';

/**
 * Copy-trading (§25): followers replicate a leader's taker trades,
 * proportionally to portfolio size, through the normal trade path — every
 * cap and rate limit applies, and every copied trade carries copied_from
 * (audit). Copied trades are never themselves copied (cascade guard), and
 * you cannot copy yourself.
 *
 * Leader incentive is deliberately not volume-based (§25): leaders with
 * ≥3 active copiers earn the creator perk — Opening Book pro — instead of
 * anything that rewards churning followers' stacks.
 */

const CREATOR_COPIER_THRESHOLD = 3;
const MIN_COPY_NOTIONAL = 10;

export async function enableCopy(followerId: number, leaderHandle: string): Promise<void> {
  const sql = db();
  const [leader] = await sql`select id from users where handle = ${leaderHandle}`;
  if (!leader) throw new Error('unknown handle');
  if (leader.id === followerId) throw new Error('cannot copy yourself');
  await sql`
    insert into copy_follows (follower_id, leader_id, active)
    values (${followerId}, ${leader.id}, true)
    on conflict (follower_id, leader_id) do update set active = true
  `;
  // copying implies following (the social edge comes free)
  await sql`insert into follows (follower_id, followee_id) values (${followerId}, ${leader.id})
    on conflict do nothing`;
}

export async function disableCopy(followerId: number, leaderHandle: string): Promise<void> {
  const sql = db();
  const [leader] = await sql`select id from users where handle = ${leaderHandle}`;
  if (!leader) return;
  await sql`update copy_follows set active = false
    where follower_id = ${followerId} and leader_id = ${leader.id}`;
}

export async function isCopying(followerId: number, leaderHandle: string): Promise<boolean> {
  const rows = await db()`
    select 1 from copy_follows cf join users u on u.id = cf.leader_id
    where cf.follower_id = ${followerId} and u.handle = ${leaderHandle} and cf.active
  `;
  return rows.length > 0;
}

async function portfolioValue(userId: number, seasonId: number): Promise<number> {
  const [row] = await db()`
    select coalesce((select cash from balances where user_id = ${userId} and season_id = ${seasonId}), 0)
      + coalesce((select sum(h.qty * (a.p0 + a.m * a.supply))
                  from holdings h join assets a on a.id = h.asset_id
                  where h.user_id = ${userId} and a.season_id = ${seasonId}), 0) as v
  `;
  return row?.v ?? 0;
}

/**
 * Replicate new leader taker-trades for active copiers. Cursor-based and
 * idempotent; a copier's failed replication (caps, cash) is skipped, never
 * retried — copy-trading is best-effort by design.
 */
export async function copyTick(seasonId: number, now: Date): Promise<{ copied: number }> {
  const sql = db();
  const cfg = await loadConfig(now);
  await sql`insert into copy_cursor (season_id) values (${seasonId}) on conflict do nothing`;
  const [{ last_trade_id }] = (await sql`
    select last_trade_id from copy_cursor where season_id = ${seasonId}
  `) as unknown as [{ last_trade_id: number }];

  const leaderTrades = await sql`
    select t.id, t.asset_id, t.user_id, t.side, t.cash_delta, t.qty
    from trades t
    join assets a on a.id = t.asset_id and a.season_id = ${seasonId}
    where t.id > ${last_trade_id} and t.actor = 'user' and not t.maker
      and t.copied_from is null
      and t.user_id in (select leader_id from copy_follows where active)
    order by t.id
    limit 100
  `;
  let copied = 0;
  let cursor = last_trade_id;

  for (const t of leaderTrades) {
    cursor = Math.max(cursor, Number(t.id));
    const copiers = await sql`
      select follower_id from copy_follows where leader_id = ${t.user_id} and active
    `;
    if (copiers.length === 0) continue;
    const leaderValue = await portfolioValue(t.user_id, seasonId);
    if (leaderValue <= 0) continue;

    for (const c of copiers) {
      const copierValue = await portfolioValue(c.follower_id, seasonId);
      const scale = copierValue / leaderValue;
      const notional = Math.min(
        Math.abs(t.cash_delta) * scale,
        cfg.trading.maxTradeNotional * 0.999,
      );
      if (notional < MIN_COPY_NOTIONAL) continue;
      try {
        await executeUserTrade(c.follower_id, {
          assetId: t.asset_id,
          side: t.side,
          notional,
          now,
          copiedFrom: Number(t.id),
        });
        copied++;
      } catch (e) {
        if (!(e instanceof TradeRejected)) throw e; // caps/cash: skip silently
      }
    }
  }

  // also advance past anything we intentionally skipped this batch
  if (leaderTrades.length === 0) {
    const [{ max_id }] = (await sql`
      select coalesce(max(t.id), ${last_trade_id}) as max_id from trades t
      join assets a on a.id = t.asset_id and a.season_id = ${seasonId}
    `) as unknown as [{ max_id: number }];
    cursor = Math.max(cursor, Number(max_id));
  }
  await sql`update copy_cursor set last_trade_id = ${cursor} where season_id = ${seasonId}`;

  // creator perk: pro for leaders with enough copiers (never volume-based)
  await sql`
    update users set plan = 'pro'
    where plan = 'free' and id in (
      select leader_id from copy_follows where active
      group by leader_id having count(*) >= ${CREATOR_COPIER_THRESHOLD}
    )
  `;
  return { copied };
}
