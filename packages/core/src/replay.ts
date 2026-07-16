import { db } from '@rook/db';

const HOUR = 3600e3;

export interface Timeline {
  /** hourly snapshot timestamps, ascending */
  ticks: Date[];
  /** assetId → prices aligned to ticks */
  prices: Map<number, number[]>;
  /** cap-weighted league index aligned to ticks (Rook Index, unnormalized) */
  index: number[];
}

/** Load the hourly price grid for a season between two instants (inclusive). */
export async function loadTimeline(seasonId: number, start: Date, end: Date): Promise<Timeline> {
  const sql = db();
  const rows = await sql`
    select p.asset_id, p.ts, p.price, p.supply
    from price_points p
    join assets a on a.id = p.asset_id
    where a.season_id = ${seasonId} and p.ts >= ${start} and p.ts <= ${end}
    order by p.ts
  `;
  const tickSet = new Map<number, Date>();
  for (const r of rows) tickSet.set(new Date(r.ts).getTime(), new Date(r.ts));
  const ticks = [...tickSet.values()].sort((a, b) => a.getTime() - b.getTime());
  const tickIndex = new Map(ticks.map((t, i) => [t.getTime(), i]));
  const prices = new Map<number, number[]>();
  const caps: number[] = ticks.map(() => 0);
  for (const r of rows) {
    const i = tickIndex.get(new Date(r.ts).getTime())!;
    let series = prices.get(r.asset_id);
    if (!series) {
      series = ticks.map(() => NaN);
      prices.set(r.asset_id, series);
    }
    series[i] = r.price;
    caps[i] = (caps[i] ?? 0) + r.price * r.supply;
  }
  // forward/back-fill gaps so every series is dense
  for (const series of prices.values()) {
    let last = NaN;
    for (let i = 0; i < series.length; i++) {
      if (Number.isNaN(series[i]!)) series[i] = last;
      else last = series[i]!;
    }
    for (let i = series.length - 2; i >= 0; i--) {
      if (Number.isNaN(series[i]!)) series[i] = series[i + 1]!;
    }
  }
  return { ticks, prices, index: caps.map((c) => (c > 0 ? c : 1)) };
}

export interface UserReplay {
  /** portfolio value (cash + holdings at snapshot prices) aligned to timeline.ticks */
  values: number[];
  /** holdings qty per asset at each tick (assetId → series) */
  qty: Map<number, number[]>;
}

/**
 * Replay a user's season from the append-only trade log onto a timeline:
 * cash and holdings at each tick, marked to snapshot prices. This is the
 * "every price change reconstructible from trades" property doing work.
 */
export async function replayUser(
  userId: number,
  seasonId: number,
  timeline: Timeline,
): Promise<UserReplay> {
  const sql = db();
  const [bal] = await sql`
    select cash, joined_at from balances where user_id = ${userId} and season_id = ${seasonId}
  `;
  if (!bal || timeline.ticks.length === 0) {
    return { values: timeline.ticks.map(() => 0), qty: new Map() };
  }
  const trades = await sql`
    select t.asset_id, t.side, t.qty, t.cash_delta, t.ts
    from trades t join assets a on a.id = t.asset_id
    where t.user_id = ${userId} and a.season_id = ${seasonId}
      and t.ts <= ${timeline.ticks[timeline.ticks.length - 1]!}
    order by t.ts
  `;
  // starting cash = current cash rolled back through all trades in range
  // simpler: recompute forward from the starting stack at join
  const [{ stack }] = (await sql`
    select cash - coalesce((
      select sum(t.cash_delta) from trades t
      join assets a on a.id = t.asset_id
      where t.user_id = ${userId} and a.season_id = ${seasonId}
    ), 0) as stack
    from balances where user_id = ${userId} and season_id = ${seasonId}
  `) as unknown as [{ stack: number }];

  let cash = stack;
  const held = new Map<number, number>();
  const values: number[] = [];
  const qtySeries = new Map<number, number[]>();
  let ti = 0;
  for (let i = 0; i < timeline.ticks.length; i++) {
    const tick = timeline.ticks[i]!.getTime();
    while (ti < trades.length && new Date(trades[ti]!.ts).getTime() <= tick) {
      const t = trades[ti]!;
      cash += t.cash_delta;
      held.set(t.asset_id, (held.get(t.asset_id) ?? 0) + (t.side === 'buy' ? t.qty : -t.qty));
      ti++;
    }
    let v = cash;
    for (const [assetId, q] of held) {
      const p = timeline.prices.get(assetId)?.[i];
      if (p !== undefined && !Number.isNaN(p)) v += q * p;
      let series = qtySeries.get(assetId);
      if (!series) {
        series = timeline.ticks.map(() => 0);
        qtySeries.set(assetId, series);
      }
      series[i] = q;
    }
    values.push(v);
  }
  return { values, qty: qtySeries };
}
