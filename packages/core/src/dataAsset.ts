import { randomBytes } from 'node:crypto';
import { db } from '@rook/db';

/**
 * Phase 6 — the data asset (§27). The measurement layer productized:
 * Rook Index feeds, per-asset price/flow/sentiment series, and
 * market-moment detection. All of it derives from the public audit trail;
 * licensing sells the lens and the pipes, not an information edge over
 * Rook's own traders (the same §25 rule, applied outward).
 */

const HOUR = 3600e3;

/**
 * Snapshot the Rook Index: cap-weighted average price relative to the flat
 * start — 100 means the league trades at p0. (Normalizing to raw market
 * cap would conflate price with deployment: a bootstrapping market's cap
 * grows from ~0 regardless of price level.)
 */
export async function snapshotIndex(seasonId: number, now: Date): Promise<number | null> {
  const sql = db();
  const hour = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const [row] = (await sql`
    select coalesce(sum((p0 + m * supply) * supply), 0) as cap,
           coalesce(sum(supply), 0) as total_supply,
           avg(p0) as avg_p0
    from assets where season_id = ${seasonId}
  `) as unknown as [{ cap: number; total_supply: number; avg_p0: number }];
  if (!row || row.total_supply <= 0 || row.avg_p0 <= 0) return null;
  const value = (100 * (row.cap / row.total_supply)) / row.avg_p0;
  await sql`
    insert into index_points (season_id, ts, market_cap, value)
    values (${seasonId}, ${hour}, ${row.cap}, ${value})
    on conflict do nothing
  `;
  return value;
}

export async function indexSeries(seasonId: number, since: Date) {
  return db()`
    select ts, value, market_cap from index_points
    where season_id = ${seasonId} and ts >= ${since} order by ts
  `;
}

/**
 * Market-moment detection: an asset moving materially inside a window,
 * attributed to the nearest signed headline when one exists. The
 * broadcast-graphics feed (§27) and the "why did this move" primitive.
 */
export async function detectMoments(seasonId: number, now: Date): Promise<number> {
  const sql = db();
  const hour = new Date(Math.floor(now.getTime() / HOUR) * HOUR); // dedup key
  const windows: Array<{ hours: number; threshold: number }> = [
    { hours: 1, threshold: 0.02 },
    { hours: 24, threshold: 0.05 },
  ];
  let found = 0;
  const assets = await sql`
    select id, p0 + m * supply as price from assets where season_id = ${seasonId}
  `;
  for (const a of assets) {
    for (const w of windows) {
      const [past] = await sql`
        select price from price_points
        where asset_id = ${a.id} and ts <= ${new Date(now.getTime() - w.hours * HOUR)}
        order by ts desc limit 1
      `;
      if (!past || past.price <= 0) continue;
      const ret = a.price / past.price - 1;
      if (Math.abs(ret) < w.threshold) continue;
      const [news] = await sql`
        select id, headline from news_events
        where asset_id = ${a.id} and sign is not null
          and ts > ${new Date(now.getTime() - 24 * HOUR)} and ts <= ${now}
          and sign = ${ret >= 0 ? 1 : -1}
        order by ts desc limit 1
      `;
      const inserted = await sql`
        insert into moments (asset_id, ts, window_hours, ret, price, headline, news_event_id)
        values (${a.id}, ${hour}, ${w.hours}, ${ret}, ${a.price},
                ${news?.headline ?? 'market flow'}, ${news?.id ?? null})
        on conflict do nothing
        returning id
      `;
      found += inserted.length;
    }
  }
  return found;
}

export async function recentMoments(seasonId: number, limit = 30) {
  return db()`
    select m.ts, m.window_hours, m.ret, m.price, m.headline,
           a.symbol, a.name, a.kind
    from moments m join assets a on a.id = m.asset_id
    where a.season_id = ${seasonId}
    order by m.ts desc limit ${limit}
  `;
}

// ---------------------------------------------------------------- API keys

export async function mintApiKey(name: string, dailyLimit = 1000): Promise<string> {
  const key = `rk_${randomBytes(18).toString('base64url')}`;
  await db()`insert into api_keys (key, name, daily_limit) values (${key}, ${name}, ${dailyLimit})`;
  return key;
}

export class DataAuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Validate a licensee key and burn one request against its daily limit. */
export async function authorizeDataRequest(key: string | null, endpoint: string): Promise<void> {
  if (!key) throw new DataAuthError(401, 'missing x-rook-key header');
  const sql = db();
  const [row] = await sql`
    select name, daily_limit from api_keys where key = ${key} and revoked_at is null
  `;
  if (!row) throw new DataAuthError(401, 'invalid or revoked key');
  const dayAgo = new Date(Date.now() - 24 * HOUR);
  const [{ used }] = (await sql`
    select count(*)::int as used from events
    where kind = 'data:request' and props->>'key' = ${key} and ts > ${dayAgo}
  `) as unknown as [{ used: number }];
  if (used >= row.daily_limit) throw new DataAuthError(429, 'daily request limit reached');
  await sql`insert into events (user_id, kind, props)
    values (null, 'data:request', ${sql.json({ key, name: row.name, endpoint })})`;
}

/** Per-asset sentiment/flow series for licensees (daily granularity). */
export async function sentimentSeries(assetId: number, days: number, now: Date) {
  const since = new Date(now.getTime() - days * 86400e3);
  return db()`
    select date_trunc('day', ts) as day,
      sum(case when side = 'buy' then abs(cash_delta) else -abs(cash_delta) end) as net_flow,
      sum(abs(cash_delta)) as volume,
      count(*) filter (where side = 'buy')::float / greatest(count(*), 1) as buy_trade_share
    from trades
    where asset_id = ${assetId} and actor = 'user' and not maker and ts > ${since}
    group by 1 order by 1
  `;
}
