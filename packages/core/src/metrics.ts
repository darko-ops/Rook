import { db } from '@rook/db';
import { raceDaySet } from './races.js';

const DAY = 86400e3;

/**
 * §18 exit criteria + §22 instrumentation, computed from the events/trades/
 * follows tables. "The beta lives or dies on these."
 */
export interface BetaMetrics {
  asOf: Date;
  joined: number;
  weeklyActives: number;
  /** mean over trailing 28 days: distinct daily openers / users joined by that day */
  dailyOpenRate: number;
  /** §18: share of weekly actives who opened on a non-race day (target ≥ 0.40) */
  nonRaceDayOpenShare: number;
  /** §18: D7 retention for follow-graph-connected users (target ≥ 0.35) */
  d7Connected: number | null;
  d1: number | null;
  d7: number | null;
  d30: number | null;
  /** §18: median leaderboard opens per weekly active, trailing 7d (target ≥ 2) */
  leaderboardViewsMedian: number;
  tradesPerWeeklyActive: number;
  followDensity: number; // edges per joined user
  /** R1: p95 house share of daily price movement, trader-active asset-days */
  houseShareP95: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export async function betaMetrics(seasonId: number, now: Date): Promise<BetaMetrics> {
  const sql = db();
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const monthAgo = new Date(now.getTime() - 28 * DAY);
  const raceDays = await raceDaySet(seasonId);

  const [{ joined }] = (await sql`
    select count(*)::int as joined from balances where season_id = ${seasonId}
  `) as unknown as [{ joined: number }];

  // opens: any open:* event
  const opens = await sql`
    select user_id, ts from events
    where kind like 'open:%' and user_id is not null and ts > ${monthAgo} and ts <= ${now}
  `;

  const weeklySet = new Set<number>();
  const nonRaceOpeners = new Set<number>();
  const openersByDay = new Map<string, Set<number>>();
  for (const o of opens) {
    const day = new Date(o.ts).toISOString().slice(0, 10);
    (openersByDay.get(day) ?? openersByDay.set(day, new Set()).get(day)!).add(o.user_id);
    if (new Date(o.ts) > weekAgo) {
      weeklySet.add(o.user_id);
      if (!raceDays.has(day)) nonRaceOpeners.add(o.user_id);
    }
  }
  const dailyRates: number[] = [];
  for (let d = 27; d >= 0; d--) {
    const day = new Date(now.getTime() - d * DAY).toISOString().slice(0, 10);
    const [{ n }] = (await sql`
      select count(*)::int as n from balances
      where season_id = ${seasonId} and joined_at <= ${new Date(now.getTime() - d * DAY)}
    `) as unknown as [{ n: number }];
    if (n > 0) dailyRates.push((openersByDay.get(day)?.size ?? 0) / n);
  }
  const dailyOpenRate = dailyRates.length
    ? dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length
    : 0;

  // retention cohorts: active = any open event or trade on day N after join
  const cohort = await sql`
    select b.user_id, b.joined_at,
      exists(select 1 from follows f where f.follower_id = b.user_id or f.followee_id = b.user_id) as connected
    from balances b where b.season_id = ${seasonId}
  `;
  const activity = await sql`
    select user_id, ts from events where user_id is not null and kind like 'open:%'
    union all
    select user_id, ts from trades where user_id is not null
  `;
  const activityByUser = new Map<number, number[]>();
  for (const a of activity) {
    (activityByUser.get(a.user_id) ?? activityByUser.set(a.user_id, []).get(a.user_id)!)
      .push(new Date(a.ts).getTime());
  }
  const retention = (dayN: number, onlyConnected: boolean): number | null => {
    let eligible = 0;
    let retained = 0;
    for (const u of cohort) {
      if (onlyConnected && !u.connected) continue;
      const join = new Date(u.joined_at).getTime();
      if (now.getTime() - join < (dayN + 1) * DAY) continue; // too recent to measure
      eligible++;
      const lo = join + dayN * DAY;
      const hi = join + (dayN + 1) * DAY;
      if ((activityByUser.get(u.user_id) ?? []).some((t) => t >= lo && t < hi)) retained++;
    }
    return eligible > 0 ? retained / eligible : null;
  };

  // leaderboard views per weekly active, trailing 7d
  const boardOpens = await sql`
    select user_id, count(*)::int as n from events
    where kind = 'open:leaderboard' and ts > ${weekAgo} and user_id is not null
    group by user_id
  `;
  const boardCounts = new Map(boardOpens.map((r) => [r.user_id as number, r.n as number]));
  const leaderboardViewsMedian = median([...weeklySet].map((u) => boardCounts.get(u) ?? 0));

  const [{ weekTrades }] = (await sql`
    select count(*)::int as "weekTrades" from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId} and t.actor = 'user' and t.ts > ${weekAgo}
  `) as unknown as [{ weekTrades: number }];

  const [{ edges }] = (await sql`
    select count(*)::int as edges from follows
  `) as unknown as [{ edges: number }];

  const shares = await sql`
    select date_trunc('day', t.ts) as day, t.asset_id,
      coalesce(sum(abs(t.price_after - t.price_before)) filter (where t.actor = 'house'), 0) as house,
      coalesce(sum(abs(t.price_after - t.price_before)) filter (where t.actor = 'user'), 0) as organic,
      coalesce(sum(abs(t.cash_delta)) filter (where t.actor = 'user'), 0) as organic_notional
    from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId}
    group by 1, 2
  `;
  const shareVals = shares
    .filter((s) => s.organic_notional >= 250 && s.house + s.organic > 0)
    .map((s) => s.house / (s.house + s.organic))
    .sort((x, y) => x - y);
  const houseShareP95 = shareVals[Math.floor(0.95 * (shareVals.length - 1))] ?? 0;

  return {
    asOf: now,
    joined,
    weeklyActives: weeklySet.size,
    dailyOpenRate,
    nonRaceDayOpenShare: weeklySet.size > 0 ? nonRaceOpeners.size / weeklySet.size : 0,
    d1: retention(1, false),
    d7: retention(7, false),
    d7Connected: retention(7, true),
    d30: retention(30, false),
    leaderboardViewsMedian,
    tradesPerWeeklyActive: weeklySet.size > 0 ? weekTrades / weeklySet.size : 0,
    followDensity: joined > 0 ? edges / joined : 0,
    houseShareP95,
  };
}

/** §18 exit gates with targets; calibrate in beta. */
export function exitGates(m: BetaMetrics, capC: number) {
  return [
    { name: 'non-race-day open share ≥ 40% of weekly actives', value: m.nonRaceDayOpenShare, pass: m.nonRaceDayOpenShare >= 0.4 },
    { name: 'D7 retention (friend-graph-connected) ≥ 35%', value: m.d7Connected, pass: m.d7Connected !== null && m.d7Connected >= 0.35 },
    { name: 'median leaderboard views ≥ 2×/week', value: m.leaderboardViewsMedian, pass: m.leaderboardViewsMedian >= 2 },
    { name: `house share p95 ≤ cap (${100 * capC}%) on active days`, value: m.houseShareP95, pass: m.houseShareP95 <= capC + 0.02 },
  ];
}
