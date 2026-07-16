import { db } from '@rook/db';
import { loadConfig } from './config.js';

export interface TeamSpec {
  symbol: string;
  name: string;
  color: string;
}

/** 2026-grid F1 constructors — the launch assets. */
export const F1_TEAMS: TeamSpec[] = [
  { symbol: 'RBR', name: 'Red Bull Racing', color: '#3671C6' },
  { symbol: 'FER', name: 'Ferrari', color: '#E8002D' },
  { symbol: 'MER', name: 'Mercedes', color: '#27F4D2' },
  { symbol: 'MCL', name: 'McLaren', color: '#FF8000' },
  { symbol: 'AST', name: 'Aston Martin', color: '#229971' },
  { symbol: 'ALP', name: 'Alpine', color: '#0093CC' },
  { symbol: 'WIL', name: 'Williams', color: '#64C4FF' },
  { symbol: 'VRB', name: 'Racing Bulls', color: '#6692FF' },
  { symbol: 'AUD', name: 'Audi', color: '#BBBBBB' },
  { symbol: 'HAA', name: 'Haas', color: '#B6BABD' },
  { symbol: 'CAD', name: 'Cadillac', color: '#B8860B' },
];

export async function openSeason(
  league: string,
  name: string,
  teams: TeamSpec[],
  startsAt: Date,
  endsAt: Date,
): Promise<number> {
  const cfg = await loadConfig(startsAt);
  const sql = db();
  return sql.begin(async (tx) => {
    const [season] = await tx`
      insert into seasons (league, name, starts_at, ends_at, status)
      values (${league}, ${name}, ${startsAt}, ${endsAt}, 'open')
      returning id
    `;
    for (const t of teams) {
      // identical p0 for every asset: no implied house ranking (§13.1)
      await tx`insert into assets (season_id, symbol, name, color, p0, m)
        values (${season!.id}, ${t.symbol}, ${t.name}, ${t.color},
                ${cfg.curve.p0}, ${cfg.curve.m})`;
    }
    return season!.id as number;
  });
}

export async function currentSeason(now: Date): Promise<{ id: number; league: string; name: string; starts_at: Date; ends_at: Date; status: string } | null> {
  const rows = await db()`
    select * from seasons where status = 'open' and starts_at <= ${now}
    order by starts_at desc limit 1
  `;
  return (rows[0] as never) ?? null;
}

/** Equal stack on join, mid-season entry included (§18). Idempotent. */
export async function joinSeason(userId: number, seasonId: number, now: Date): Promise<void> {
  const cfg = await loadConfig(now);
  await db()`
    insert into balances (user_id, season_id, cash, joined_at)
    values (${userId}, ${seasonId}, ${cfg.trading.startingStack}, ${now})
    on conflict do nothing
  `;
}

/**
 * Settlement (decision H): each asset settles at the time-weighted average
 * price over the final week, computed from hourly price_points. TWAP resists
 * last-minute manipulation; pure sentiment end-to-end.
 */
export async function settleSeason(seasonId: number, now: Date): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    const [season] = await tx`select * from seasons where id = ${seasonId} for update`;
    if (!season || season.status !== 'open') throw new Error('season not open');
    const weekAgo = new Date(new Date(season.ends_at).getTime() - 7 * 86400e3);
    const assets = await tx`select id from assets where season_id = ${seasonId}`;
    for (const a of assets) {
      const [twap] = await tx`
        select avg(price) as p from price_points
        where asset_id = ${a.id} and ts >= ${weekAgo} and ts <= ${season.ends_at}
      `;
      const [spot] = await tx`select p0 + m * supply as p from assets where id = ${a.id}`;
      const price = twap?.p ?? spot!.p;
      await tx`update assets set settled_price = ${price} where id = ${a.id}`;
      // convert all holdings to cash at the settlement price
      await tx`
        update balances b set cash = b.cash + h.qty * ${price}
        from holdings h
        where h.asset_id = ${a.id} and b.user_id = h.user_id and b.season_id = ${seasonId}
      `;
      await tx`update holdings set qty = 0 where asset_id = ${a.id}`;
    }
    await tx`update seasons set status = 'settled' where id = ${seasonId}`;
  });
}
