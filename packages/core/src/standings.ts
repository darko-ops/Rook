import { db } from '@rook/db';
import type { MagnitudeClass } from '@rook/engine';

/**
 * Real constructor standings via the Jolpica API (the Ergast successor).
 *
 * Two uses, both constitution-safe (§2 "Rook prices nothing"):
 *  1. Display — standings are market research context on the market screens.
 *     Traders who see a P1 team priced sixth do the repricing themselves.
 *  2. Race-result events — when a new round lands, each team's points haul
 *     becomes a classified news event (sign + magnitude only) consumed by
 *     the house mover through its normal capped, decaying path. A nudge in
 *     the direction of the result, never a target price.
 */

export const CONSTRUCTOR_TO_SYMBOL: Record<string, string> = {
  red_bull: 'RBR',
  ferrari: 'FER',
  mercedes: 'MER',
  mclaren: 'MCL',
  aston_martin: 'AST',
  alpine: 'ALP',
  williams: 'WIL',
  rb: 'VRB',
  audi: 'AUD',
  sauber: 'AUD',
  haas: 'HAA',
  cadillac: 'CAD',
};

export interface StandingRow {
  symbol: string;
  round: number;
  position: number;
  points: number;
  wins: number;
  name: string;
}

const STANDINGS_URL = 'https://api.jolpi.ca/ergast/f1/current/constructorstandings.json';
const DRIVER_STANDINGS_URL = 'https://api.jolpi.ca/ergast/f1/current/driverstandings.json?limit=40';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; RookBeta/0.1)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`standings fetch failed: ${res.status}`);
  return res.json();
}

export interface DriverRow {
  code: string; // 3-letter driver code = asset symbol
  name: string;
  constructorId: string;
  round: number;
  position: number;
  points: number;
  wins: number;
}

/** Current driver standings — also the authoritative 2026 roster. */
export async function fetchDriverStandings(): Promise<DriverRow[]> {
  const data = (await getJson(DRIVER_STANDINGS_URL)) as {
    MRData: {
      StandingsTable: {
        StandingsLists: Array<{
          round: string;
          DriverStandings: Array<{
            position: string;
            points: string;
            wins: string;
            Driver: { code?: string; givenName: string; familyName: string; driverId: string };
            Constructors: Array<{ constructorId: string }>;
          }>;
        }>;
      };
    };
  };
  const list = data.MRData.StandingsTable.StandingsLists[0];
  if (!list) return [];
  const round = Number(list.round);
  return list.DriverStandings.flatMap((s) => {
    const constructorId = s.Constructors[s.Constructors.length - 1]?.constructorId;
    const code = s.Driver.code;
    if (!constructorId || !code || !CONSTRUCTOR_TO_SYMBOL[constructorId]) return [];
    return [{
      code,
      name: `${s.Driver.givenName} ${s.Driver.familyName}`,
      constructorId,
      round,
      position: Number(s.position),
      points: Number(s.points),
      wins: Number(s.wins),
    }];
  });
}

export async function fetchStandings(): Promise<StandingRow[]> {
  const data = (await getJson(STANDINGS_URL)) as {
    MRData: {
      StandingsTable: {
        StandingsLists: Array<{
          round: string;
          ConstructorStandings: Array<{
            position: string;
            points: string;
            wins: string;
            Constructor: { constructorId: string; name: string };
          }>;
        }>;
      };
    };
  };
  const list = data.MRData.StandingsTable.StandingsLists[0];
  if (!list) return [];
  const round = Number(list.round);
  return list.ConstructorStandings.flatMap((s) => {
    const symbol = CONSTRUCTOR_TO_SYMBOL[s.Constructor.constructorId];
    if (!symbol) return [];
    return [{
      symbol,
      round,
      position: Number(s.position),
      points: Number(s.points),
      wins: Number(s.wins),
      name: s.Constructor.name,
    }];
  });
}

/**
 * Points-per-round → classified event. Absolute, simple, disclosed:
 * a big haul is good news, a blank round is bad news, the middle is
 * display-only. (Both cars combined; max haul ≈ 44.)
 */
export function classifyRoundResult(
  pointsDelta: number,
  kind: 'team' | 'driver' = 'team',
): { sign: 1 | -1 | null; magnitude: MagnitudeClass } {
  if (kind === 'driver') {
    // one car, max haul ≈ 26; a blank round is routine for backmarkers, so
    // it stays display-only — negative driver news comes from the feed
    if (pointsDelta >= 20) return { sign: 1, magnitude: 'large' };
    if (pointsDelta >= 10) return { sign: 1, magnitude: 'medium' };
    if (pointsDelta >= 4) return { sign: 1, magnitude: 'small' };
    return { sign: null, magnitude: 'small' };
  }
  if (pointsDelta >= 30) return { sign: 1, magnitude: 'large' };
  if (pointsDelta >= 15) return { sign: 1, magnitude: 'medium' };
  if (pointsDelta >= 6) return { sign: 1, magnitude: 'small' };
  if (pointsDelta >= 1) return { sign: null, magnitude: 'small' }; // scored, barely: context only
  return { sign: -1, magnitude: 'medium' }; // pointless weekend
}

const SYNC_INTERVAL_MS = 4 * 3600e3;

/**
 * Sync standings for the open season. On a new round, emit one result event
 * per asset with the round's points delta. Throttled; failures degrade
 * gracefully (standings just go stale, nothing else breaks).
 */
export async function syncStandings(seasonId: number, now: Date): Promise<{ synced: boolean; events: number }> {
  const sql = db();
  const [freshest] = await sql`
    select max(updated_at) as ts from standings where season_id = ${seasonId}
  `;
  if (freshest?.ts && now.getTime() - new Date(freshest.ts).getTime() < SYNC_INTERVAL_MS) {
    return { synced: false, events: 0 };
  }
  let teamRows: StandingRow[];
  let driverRows: DriverRow[];
  try {
    [teamRows, driverRows] = await Promise.all([fetchStandings(), fetchDriverStandings()]);
  } catch (e) {
    console.warn(`standings: ${e instanceof Error ? e.message : e}`);
    return { synced: false, events: 0 };
  }
  const assets = await sql`select id, symbol, name, kind from assets where season_id = ${seasonId}`;
  const byKey = new Map(assets.map((a) => [`${a.kind}:${a.symbol}`, a]));
  let events = 0;

  const upsert = async (
    key: string,
    kind: 'team' | 'driver',
    r: { round: number; position: number; points: number; wins: number },
  ) => {
    const asset = byKey.get(key);
    if (!asset) return;
    const [old] = await sql`
      select round, points from standings where season_id = ${seasonId} and asset_id = ${asset.id}
    `;
    await sql`
      insert into standings (season_id, asset_id, round, position, points, wins, updated_at)
      values (${seasonId}, ${asset.id}, ${r.round}, ${r.position}, ${r.points}, ${r.wins}, ${now})
      on conflict (season_id, asset_id) do update set
        round = ${r.round}, position = ${r.position}, points = ${r.points},
        wins = ${r.wins}, updated_at = ${now}
    `;
    if (old && r.round > old.round) {
      const delta = r.points - old.points;
      const { sign, magnitude } = classifyRoundResult(delta, kind);
      if (kind === 'driver' && sign === null) return; // routine blank round: no feed noise
      const label = kind === 'driver' ? "drivers' championship" : 'championship';
      const headline = `Round ${r.round}: ${asset.name} score${kind === 'driver' ? 's' : ''} ${delta} point${delta === 1 ? '' : 's'} — P${r.position} in the ${label} (${r.points} pts)`;
      await sql`
        insert into news_events (ts, headline, source, url, asset_id, sign, magnitude)
        values (${now}, ${headline}, 'standings', null, ${asset.id}, ${sign}, ${magnitude})
      `;
      events++;
    }
  };

  for (const r of teamRows) await upsert(`team:${r.symbol}`, 'team', r);
  for (const r of driverRows) await upsert(`driver:${r.code}`, 'driver', r);
  return { synced: true, events };
}

/**
 * Add driver assets to an open season from the live roster (driver
 * standings double as the authoritative grid). Idempotent; new assets
 * start at the flat p0 like everything else — the market ranks them.
 */
export async function addDriversToSeason(seasonId: number, now: Date): Promise<number> {
  const sql = db();
  const cfg = await import('./config.js').then((m) => m.loadConfig(now));
  const drivers = await fetchDriverStandings();
  const teams = await sql`
    select symbol, color from assets where season_id = ${seasonId} and kind = 'team'
  `;
  const teamColor = new Map(teams.map((t) => [t.symbol as string, t.color as string]));
  let added = 0;
  for (const d of drivers) {
    const teamSymbol = CONSTRUCTOR_TO_SYMBOL[d.constructorId]!;
    const inserted = await sql`
      insert into assets (season_id, symbol, name, color, p0, m, kind, team_symbol)
      values (${seasonId}, ${d.code}, ${d.name}, ${teamColor.get(teamSymbol) ?? '#888888'},
              ${cfg.curve.p0}, ${cfg.curve.m}, 'driver', ${teamSymbol})
      on conflict (season_id, symbol) do nothing
      returning id
    `;
    added += inserted.length;
  }
  return added;
}

export interface AssetStanding {
  assetId: number;
  position: number;
  points: number;
  wins: number;
  round: number;
}

export async function standingsFor(seasonId: number): Promise<Map<number, AssetStanding>> {
  const rows = await db()`
    select asset_id, position, points, wins, round from standings where season_id = ${seasonId}
  `;
  return new Map(
    rows.map((r) => [
      r.asset_id as number,
      { assetId: r.asset_id, position: r.position, points: r.points, wins: r.wins, round: r.round },
    ]),
  );
}
