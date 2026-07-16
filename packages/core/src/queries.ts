import { db } from '@rook/db';
import { loadConfig } from './config.js';
import { isProvisional, rankFor, type Rank } from './rank.js';
import { loadTimeline, replayUser } from './replay.js';

const HOUR = 3600e3;
const DAY = 86400e3;

export interface AssetRow {
  id: number;
  symbol: string;
  name: string;
  color: string;
  price: number;
  ret24h: number;
  ret7d: number;
  retSeason: number;
  volume24h: number;
  kind: 'team' | 'driver';
  teamSymbol: string | null;
  /** real championship standing, when synced (display context, §15) */
  standing: { position: number; points: number; wins: number; round: number } | null;
}

async function priceAgo(assetId: number, now: Date, ms: number): Promise<number | null> {
  const rows = await db()`
    select price from price_points
    where asset_id = ${assetId} and ts <= ${new Date(now.getTime() - ms)}
    order by ts desc limit 1
  `;
  return rows[0]?.price ?? null;
}

export async function listAssets(
  seasonId: number,
  now: Date,
  kind?: 'team' | 'driver',
): Promise<AssetRow[]> {
  const sql = db();
  const assets = await sql`
    select a.id, a.symbol, a.name, a.color, a.p0, a.m, a.supply, a.kind, a.team_symbol,
           a.p0 + a.m * a.supply as price,
           s.position, s.points, s.wins, s.round
    from assets a
    left join standings s on s.asset_id = a.id and s.season_id = a.season_id
    where a.season_id = ${seasonId} ${kind ? sql`and a.kind = ${kind}` : sql``}
    order by price desc
  `;
  const dayAgo = new Date(now.getTime() - DAY);
  const out: AssetRow[] = [];
  for (const a of assets) {
    const p24 = await priceAgo(a.id, now, DAY);
    const p7d = await priceAgo(a.id, now, 7 * DAY);
    const [{ vol }] = (await sql`
      select coalesce(sum(abs(cash_delta)), 0) as vol from trades
      where asset_id = ${a.id} and ts > ${dayAgo}
    `) as unknown as [{ vol: number }];
    out.push({
      id: a.id,
      symbol: a.symbol,
      name: a.name,
      color: a.color,
      price: a.price,
      ret24h: p24 ? a.price / p24 - 1 : 0,
      ret7d: p7d ? a.price / p7d - 1 : 0,
      retSeason: a.price / a.p0 - 1,
      volume24h: vol,
      kind: a.kind,
      teamSymbol: a.team_symbol,
      standing:
        a.position != null
          ? { position: a.position, points: a.points, wins: a.wins, round: a.round }
          : null,
    });
  }
  return out;
}

/** The measurement layer (§15): every metric market-activity-only. */
export interface Measurement {
  momentum: number; // EMA of signed net flow, normalized by volume
  volume24h: number;
  volume7d: number;
  volatility: number; // daily-ized stdev of hourly returns, 7d
  holders: number;
  top10Share: number; // share of held supply owned by top 10% of holders
  conviction: number; // buy notional / total notional, 7d (0.5 = balanced)
  leagueRelative7d: number; // asset 7d return − index 7d return
  whaleTrades: Array<{ ts: Date; side: string; notional: number; priceImpact: number }>;
}

export async function measure(assetId: number, seasonId: number, now: Date): Promise<Measurement> {
  const sql = db();
  const week = new Date(now.getTime() - 7 * DAY);
  const dayAgo = new Date(now.getTime() - DAY);

  const flows = await sql`
    select side, ts, abs(cash_delta) as notional, abs(price_after - price_before) as impact
    from trades where asset_id = ${assetId} and ts > ${week} and actor = 'user'
    order by ts
  `;
  const volume7d = flows.reduce((s, f) => s + f.notional, 0);
  const volume24h = flows.filter((f) => new Date(f.ts) > dayAgo).reduce((s, f) => s + f.notional, 0);
  const buys = flows.filter((f) => f.side === 'buy').reduce((s, f) => s + f.notional, 0);
  const conviction = volume7d > 0 ? buys / volume7d : 0.5;

  // momentum: daily signed net flow → EMA(α=0.35), normalized by 7d avg volume
  let ema = 0;
  for (let d = 6; d >= 0; d--) {
    const from = new Date(now.getTime() - (d + 1) * DAY);
    const to = new Date(now.getTime() - d * DAY);
    const net = flows
      .filter((f) => new Date(f.ts) > from && new Date(f.ts) <= to)
      .reduce((s, f) => s + (f.side === 'buy' ? f.notional : -f.notional), 0);
    ema = 0.35 * net + 0.65 * ema;
  }
  const momentum = volume7d > 0 ? ema / (volume7d / 7) : 0;

  const points = await sql`
    select price from price_points where asset_id = ${assetId} and ts > ${week} order by ts
  `;
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.price;
    if (prev > 0) rets.push(points[i]!.price / prev - 1);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const volatility = Math.sqrt(variance) * Math.sqrt(24);

  const holders = await sql`
    select qty from holdings where asset_id = ${assetId} and qty > 1e-9 order by qty desc
  `;
  const heldTotal = holders.reduce((s, h) => s + h.qty, 0);
  const topN = Math.max(1, Math.ceil(holders.length * 0.1));
  const topQty = holders.slice(0, topN).reduce((s, h) => s + h.qty, 0);

  // whale activity: user trades > 10% of 24h volume, surfaced not hidden (§10)
  const whaleFloor = Math.max(200, volume24h * 0.1);
  const whales = await sql`
    select ts, side, abs(cash_delta) as notional,
           abs(price_after / nullif(price_before, 0) - 1) as impact
    from trades
    where asset_id = ${assetId} and actor = 'user' and ts > ${dayAgo}
      and abs(cash_delta) >= ${whaleFloor}
    order by ts desc limit 10
  `;

  // league-relative strength vs cap-weighted index
  const timeline = await loadTimeline(seasonId, week, now);
  let leagueRelative7d = 0;
  const series = timeline.prices.get(assetId);
  if (series && series.length > 1 && timeline.index.length > 1) {
    const a0 = series[0]!;
    const a1 = series[series.length - 1]!;
    const i0 = timeline.index[0]!;
    const i1 = timeline.index[timeline.index.length - 1]!;
    if (a0 > 0 && i0 > 0) leagueRelative7d = (a1 / a0 - 1) - (i1 / i0 - 1);
  }

  return {
    momentum,
    volume24h,
    volume7d,
    volatility,
    holders: holders.length,
    top10Share: heldTotal > 0 ? topQty / heldTotal : 0,
    conviction,
    leagueRelative7d,
    whaleTrades: whales.map((w) => ({
      ts: new Date(w.ts),
      side: w.side,
      notional: w.notional,
      priceImpact: w.impact ?? 0,
    })),
  };
}

export interface PortfolioView {
  cash: number;
  totalValue: number;
  seasonReturn: number;
  rookScore: number | null;
  rank: Rank | null;
  provisional: boolean;
  sparkline: number[]; // daily portfolio values
  holdings: Array<{
    assetId: number;
    symbol: string;
    name: string;
    color: string;
    qty: number;
    price: number;
    value: number;
    dayChange: number;
    seasonChange: number; // vs avg cost
  }>;
}

export async function portfolio(userId: number, seasonId: number, now: Date): Promise<PortfolioView | null> {
  const sql = db();
  const cfg = await loadConfig(now);
  const [bal] = await sql`
    select cash from balances where user_id = ${userId} and season_id = ${seasonId}
  `;
  if (!bal) return null;
  const rows = await sql`
    select h.asset_id, h.qty, h.avg_cost, a.symbol, a.name, a.color,
           a.p0 + a.m * a.supply as price
    from holdings h join assets a on a.id = h.asset_id
    where h.user_id = ${userId} and a.season_id = ${seasonId} and h.qty > 1e-9
    order by h.qty * (a.p0 + a.m * a.supply) desc
  `;
  const holdings = [];
  let total: number = bal.cash;
  for (const h of rows) {
    const p24 = await priceAgo(h.asset_id, now, DAY);
    const value = h.qty * h.price;
    total += value;
    holdings.push({
      assetId: h.asset_id,
      symbol: h.symbol,
      name: h.name,
      color: h.color,
      qty: h.qty,
      price: h.price,
      value,
      dayChange: p24 ? h.price / p24 - 1 : 0,
      seasonChange: h.avg_cost > 0 ? h.price / h.avg_cost - 1 : 0,
    });
  }
  const [scoreRow] = await sql`
    select rook_score, windows_played from scores
    where user_id = ${userId} and season_id = ${seasonId}
  `;
  let rank: Rank | null = null;
  let provisional = false;
  if (scoreRow) {
    const [{ pct }] = (await sql`
      select (count(*) filter (where rook_score <= ${scoreRow.rook_score}))::float
             / greatest(count(*), 1) as pct
      from scores where season_id = ${seasonId}
    `) as unknown as [{ pct: number }];
    rank = rankFor(pct);
    provisional = isProvisional(scoreRow.windows_played, cfg.score.provisionalWindows);
  }

  // daily sparkline via replay over season-to-date (daily granularity)
  const [season] = await sql`select starts_at from seasons where id = ${seasonId}`;
  const timeline = await loadTimeline(seasonId, new Date(season!.starts_at), now);
  const replay = await replayUser(userId, seasonId, timeline);
  const sparkline: number[] = [];
  for (let i = 0; i < replay.values.length; i += 24) sparkline.push(replay.values[i]!);
  if (replay.values.length > 0) sparkline.push(replay.values[replay.values.length - 1]!);

  return {
    cash: bal.cash,
    totalValue: total,
    seasonReturn: total / cfg.trading.startingStack - 1,
    rookScore: scoreRow?.rook_score ?? null,
    rank,
    provisional,
    sparkline,
    holdings,
  };
}

export interface LeaderboardRow {
  handle: string;
  flair: string | null;
  rookScore: number;
  rank: Rank;
  provisional: boolean;
  seasonReturn: number;
  followers: number;
}

export async function leaderboard(seasonId: number, now: Date, limit = 50): Promise<LeaderboardRow[]> {
  const sql = db();
  const cfg = await loadConfig(now);
  const rows = await sql`
    select u.handle, u.flair, s.rook_score, s.windows_played, s.user_id, b.cash,
           (select count(*) from follows f where f.followee_id = u.id) as followers,
           coalesce((select sum(h.qty * (a.p0 + a.m * a.supply))
                     from holdings h join assets a on a.id = h.asset_id
                     where h.user_id = u.id and a.season_id = ${seasonId}), 0) as held_value
    from scores s
    join users u on u.id = s.user_id
    join balances b on b.user_id = s.user_id and b.season_id = ${seasonId}
    where s.season_id = ${seasonId}
    order by s.rook_score desc
    limit ${limit}
  `;
  const n = rows.length;
  return rows.map((r, i) => ({
    handle: r.handle,
    flair: r.flair,
    rookScore: r.rook_score,
    rank: rankFor(n > 1 ? 1 - i / (n - 1) : 1),
    provisional: isProvisional(r.windows_played, cfg.score.provisionalWindows),
    seasonReturn: (r.cash + r.held_value) / cfg.trading.startingStack - 1,
    followers: Number(r.followers),
  }));
}

export interface TraderProfile {
  handle: string;
  flair: string | null;
  createdAt: Date;
  rookScore: number | null;
  rank: Rank | null;
  provisional: boolean;
  seasonReturn: number;
  followers: number;
  following: number;
  isFollowing: boolean;
  holdings: Array<{ symbol: string; name: string; color: string; qty: number; value: number }>;
  career: Array<{ season: string; rookScore: number }>;
}

/** Public trader profile (§23.3): holdings public by default — transparency is the culture. */
export async function traderProfile(
  handle: string,
  seasonId: number,
  now: Date,
  viewerId: number | null,
): Promise<TraderProfile | null> {
  const sql = db();
  const cfg = await loadConfig(now);
  const [u] = await sql`select id, handle, flair, created_at from users where handle = ${handle}`;
  if (!u) return null;
  const [scoreRow] = await sql`
    select rook_score, windows_played from scores where user_id = ${u.id} and season_id = ${seasonId}
  `;
  let rank: Rank | null = null;
  if (scoreRow) {
    const [{ pct }] = (await sql`
      select (count(*) filter (where rook_score <= ${scoreRow.rook_score}))::float
             / greatest(count(*), 1) as pct
      from scores where season_id = ${seasonId}
    `) as unknown as [{ pct: number }];
    rank = rankFor(pct);
  }
  const [bal] = await sql`select cash from balances where user_id = ${u.id} and season_id = ${seasonId}`;
  const holdings = await sql`
    select a.symbol, a.name, a.color, h.qty, h.qty * (a.p0 + a.m * a.supply) as value
    from holdings h join assets a on a.id = h.asset_id
    where h.user_id = ${u.id} and a.season_id = ${seasonId} and h.qty > 1e-9
    order by value desc
  `;
  const heldValue = holdings.reduce((s, h) => s + h.value, 0);
  const [{ followers }] = (await sql`
    select count(*)::int as followers from follows where followee_id = ${u.id}
  `) as unknown as [{ followers: number }];
  const [{ following }] = (await sql`
    select count(*)::int as following from follows where follower_id = ${u.id}
  `) as unknown as [{ following: number }];
  let isFollowing = false;
  if (viewerId) {
    const rows = await sql`
      select 1 from follows where follower_id = ${viewerId} and followee_id = ${u.id}
    `;
    isFollowing = rows.length > 0;
  }
  const career = await sql`
    select se.name as season, sc.rook_score
    from scores sc join seasons se on se.id = sc.season_id
    where sc.user_id = ${u.id} and se.status = 'settled'
    order by se.starts_at desc
  `;
  return {
    handle: u.handle,
    flair: u.flair,
    createdAt: new Date(u.created_at),
    rookScore: scoreRow?.rook_score ?? null,
    rank,
    provisional: scoreRow ? isProvisional(scoreRow.windows_played, cfg.score.provisionalWindows) : true,
    seasonReturn: bal ? (bal.cash + heldValue) / cfg.trading.startingStack - 1 : 0,
    followers,
    following,
    isFollowing,
    holdings: holdings.map((h) => ({
      symbol: h.symbol, name: h.name, color: h.color, qty: h.qty, value: h.value,
    })),
    career: career.map((c) => ({ season: c.season, rookScore: c.rook_score })),
  };
}

export async function newsFeed(seasonId: number, now: Date, assetId?: number, limit = 30) {
  const sql = db();
  return sql`
    select n.id, n.ts, n.headline, n.source, n.sign, n.magnitude, a.symbol, a.name, a.color
    from news_events n join assets a on a.id = n.asset_id
    where a.season_id = ${seasonId} and n.ts <= ${now}
      ${assetId ? sql`and n.asset_id = ${assetId}` : sql``}
    order by n.ts desc limit ${limit}
  `;
}

/** R1 dashboard: house share of daily price movement per asset (§22). */
export async function houseShareByDay(seasonId: number, days = 14) {
  const sql = db();
  return sql`
    select date_trunc('day', t.ts) as day, a.symbol,
      sum(abs(t.price_after - t.price_before)) filter (where t.actor = 'house') as house_impact,
      sum(abs(t.price_after - t.price_before)) filter (where t.actor = 'user') as organic_impact
    from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId}
    group by 1, 2
    order by 1 desc, 2
    limit ${days * 20}
  `;
}

export async function priceHistory(assetId: number, since: Date) {
  return db()`
    select ts, price from price_points
    where asset_id = ${assetId} and ts >= ${since}
    order by ts
  `;
}
