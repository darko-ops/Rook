import { db } from '@rook/db';

/**
 * Opening Book — the pro analytics tier (§25). Depth of sight only: every
 * number here is derivable from the public audit trail; pro buys the lens,
 * not an edge the free tier can't theoretically reconstruct. Whale
 * surfacing per asset stays free on the market screen (fairness §10);
 * this is the league-wide, time-series, exportable view.
 */

export interface WhaleTapeRow {
  ts: Date;
  symbol: string;
  name: string;
  color: string;
  side: string;
  notional: number;
  impact: number;
}

/** League-wide tape of market-moving trades (pseudonymous). */
export async function whaleTape(seasonId: number, now: Date, limit = 30): Promise<WhaleTapeRow[]> {
  const week = new Date(now.getTime() - 7 * 86400e3);
  const rows = await db()`
    select t.ts, a.symbol, a.name, a.color, t.side,
           abs(t.cash_delta) as notional,
           abs(t.price_after / nullif(t.price_before, 0) - 1) as impact
    from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId} and t.actor = 'user' and t.ts > ${week}
      and abs(t.cash_delta) >= 400
    order by t.ts desc limit ${limit}
  `;
  return rows.map((r) => ({
    ts: new Date(r.ts), symbol: r.symbol, name: r.name, color: r.color,
    side: r.side, notional: r.notional, impact: r.impact ?? 0,
  }));
}

export interface ConvictionRow {
  symbol: string;
  name: string;
  color: string;
  kind: string;
  netFlow24h: number; // buys − sells, notional
  buyShare7d: number; // 0..1
  volume7d: number;
}

/** Where the market's money is leaning, by asset. */
export async function convictionBoard(seasonId: number, now: Date): Promise<ConvictionRow[]> {
  const day = new Date(now.getTime() - 86400e3);
  const week = new Date(now.getTime() - 7 * 86400e3);
  const rows = await db()`
    select a.symbol, a.name, a.color, a.kind,
      coalesce(sum(case when t.side = 'buy' then abs(t.cash_delta) else -abs(t.cash_delta) end)
        filter (where t.ts > ${day}), 0) as net_flow_24h,
      coalesce(sum(abs(t.cash_delta)) filter (where t.side = 'buy' and t.ts > ${week}), 0) as buys_7d,
      coalesce(sum(abs(t.cash_delta)) filter (where t.ts > ${week}), 0) as vol_7d
    from assets a
    left join trades t on t.asset_id = a.id and t.actor = 'user'
    where a.season_id = ${seasonId}
    group by a.id
    order by abs(coalesce(sum(case when t.side = 'buy' then abs(t.cash_delta) else -abs(t.cash_delta) end)
      filter (where t.ts > ${day}), 0)) desc
  `;
  return rows.map((r) => ({
    symbol: r.symbol, name: r.name, color: r.color, kind: r.kind,
    netFlow24h: r.net_flow_24h,
    buyShare7d: r.vol_7d > 0 ? r.buys_7d / r.vol_7d : 0.5,
    volume7d: r.vol_7d,
  }));
}

export interface OwnershipRow {
  symbol: string;
  name: string;
  color: string;
  holders: number;
  top10Share: number;
  hhi: number;
}

/** Concentration table: who actually holds this market. */
export async function ownershipTable(seasonId: number): Promise<OwnershipRow[]> {
  const assets = await db()`
    select id, symbol, name, color from assets where season_id = ${seasonId} order by symbol
  `;
  const out: OwnershipRow[] = [];
  for (const a of assets) {
    const holders = await db()`
      select qty from holdings where asset_id = ${a.id} and qty > 1e-9 order by qty desc
    `;
    const total = holders.reduce((s, h) => s + h.qty, 0);
    const topN = Math.max(1, Math.ceil(holders.length * 0.1));
    const top = holders.slice(0, topN).reduce((s, h) => s + h.qty, 0);
    const hhi = total > 0 ? holders.reduce((s, h) => s + (h.qty / total) ** 2, 0) : 0;
    out.push({
      symbol: a.symbol, name: a.name, color: a.color,
      holders: holders.length,
      top10Share: total > 0 ? top / total : 0,
      hhi,
    });
  }
  return out.sort((x, y) => y.holders - x.holders);
}

/** Daily net flow + volume series for one asset (pro chart + export). */
export async function flowSeries(assetId: number, days: number, now: Date) {
  const since = new Date(now.getTime() - days * 86400e3);
  return db()`
    select date_trunc('day', ts) as day,
      sum(case when side = 'buy' then abs(cash_delta) else -abs(cash_delta) end) as net_flow,
      sum(abs(cash_delta)) as volume
    from trades
    where asset_id = ${assetId} and actor = 'user' and ts > ${since}
    group by 1 order by 1
  `;
}

/** Full price history CSV (pro export). */
export async function priceCsv(assetId: number): Promise<string> {
  const rows = await db()`
    select ts, price, supply, volume_24h from price_points
    where asset_id = ${assetId} order by ts
  `;
  const lines = ['ts,price,supply,volume_24h'];
  for (const r of rows) {
    lines.push(`${new Date(r.ts).toISOString()},${r.price},${r.supply},${r.volume_24h}`);
  }
  return lines.join('\n');
}
