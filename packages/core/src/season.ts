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
 *
 * Open orders are cancelled first with full escrow refunds (bid cash, ask
 * shares) — settlement must never destroy value a resting order holds.
 */
export async function settleSeason(seasonId: number, now: Date): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    const [season] = await tx`select * from seasons where id = ${seasonId} for update`;
    if (!season || season.status !== 'open') throw new Error('season not open');

    // 1. cancel every open order, refunding escrow
    const openOrders = await tx`
      select o.id, o.user_id, o.asset_id, o.side, o.remaining, o.limit_price
      from orders o join assets a on a.id = o.asset_id
      where a.season_id = ${seasonId} and o.status = 'open'
      for update of o
    `;
    for (const o of openOrders) {
      if (o.side === 'buy') {
        await tx`update balances set cash = cash + ${o.remaining * o.limit_price}
          where user_id = ${o.user_id} and season_id = ${seasonId}`;
      } else {
        await tx`update holdings set qty = qty + ${o.remaining}
          where user_id = ${o.user_id} and asset_id = ${o.asset_id}`;
      }
      await tx`update orders set status = 'cancelled' where id = ${o.id}`;
    }

    // 2. settle every asset per the configured mode (decision H)
    const cfg = await loadConfig(now);
    const weekAgo = new Date(new Date(season.ends_at).getTime() - 7 * 86400e3);
    const assets = await tx`select id, kind from assets where season_id = ${seasonId}`;
    for (const a of assets) {
      let price: number | null = null;
      if (cfg.settlement.mode === 'standings') {
        const [standing] = await tx`
          select position from standings where season_id = ${seasonId} and asset_id = ${a.id}
        `;
        const table =
          a.kind === 'driver' ? cfg.settlement.driverPayouts : cfg.settlement.teamPayouts;
        if (standing) {
          // positions beyond the table settle at its last (lowest) payout
          price = table[Math.min(standing.position, table.length) - 1] ?? null;
        }
      }
      if (price === null) {
        // TWAP mode — and the fallback when standings are missing
        const [twap] = await tx`
          select avg(price) as p from price_points
          where asset_id = ${a.id} and ts >= ${weekAgo} and ts <= ${season.ends_at}
        `;
        const [spot] = await tx`select p0 + m * supply as p from assets where id = ${a.id}`;
        price = twap?.p ?? spot!.p;
      }
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

/**
 * The season turn (§12, §24.12): settle the old season, re-issue assets
 * for the new one at the identical flat p0, hand every participant a fresh
 * equal stack, and carry the record forward — new-season Rook Scores seed
 * from final ratings (Elo persists; the ladder is a career, not a season).
 * Losers get a clean slate, winners get history (§7).
 */
export async function rolloverSeason(
  oldSeasonId: number,
  newName: string,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): Promise<number> {
  const sql = db();
  await settleSeason(oldSeasonId, now);

  const [old] = await sql`select league from seasons where id = ${oldSeasonId}`;
  if (!old) throw new Error('unknown season');
  const teams = await sql`
    select symbol, name, color, kind, team_symbol from assets
    where season_id = ${oldSeasonId} order by kind desc, symbol
  `;
  const cfg = await loadConfig(now);
  const newSeasonId = await sql.begin(async (tx) => {
    const [season] = await tx`
      insert into seasons (league, name, starts_at, ends_at, status)
      values (${old.league}, ${newName}, ${startsAt}, ${endsAt}, 'open')
      returning id
    `;
    for (const t of teams) {
      await tx`
        insert into assets (season_id, symbol, name, color, p0, m, kind, team_symbol)
        values (${season!.id}, ${t.symbol}, ${t.name}, ${t.color},
                ${cfg.curve.p0}, ${cfg.curve.m}, ${t.kind}, ${t.team_symbol})
      `;
    }
    // everyone re-receives the standard stack (§12); no opt-in friction
    await tx`
      insert into balances (user_id, season_id, cash, joined_at)
      select user_id, ${season!.id}, ${cfg.trading.startingStack}, ${now}
      from balances where season_id = ${oldSeasonId}
    `;
    // Rook Score persists across seasons: seed from final ratings
    await tx`
      insert into scores (user_id, season_id, rook_score, windows_played, window_stats, updated_at)
      select user_id, ${season!.id}, rook_score, windows_played,
             ${tx.json({ carried: true })}, ${now}
      from scores where season_id = ${oldSeasonId}
    `;
    return season!.id as number;
  });
  return newSeasonId;
}
