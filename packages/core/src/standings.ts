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

export async function fetchStandings(): Promise<StandingRow[]> {
  const res = await fetch(STANDINGS_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; RookBeta/0.1)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`standings fetch failed: ${res.status}`);
  const data = (await res.json()) as {
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
export function classifyRoundResult(pointsDelta: number): { sign: 1 | -1 | null; magnitude: MagnitudeClass } {
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
  let rows: StandingRow[];
  try {
    rows = await fetchStandings();
  } catch (e) {
    console.warn(`standings: ${e instanceof Error ? e.message : e}`);
    return { synced: false, events: 0 };
  }
  const assets = await sql`select id, symbol, name from assets where season_id = ${seasonId}`;
  const bySymbol = new Map(assets.map((a) => [a.symbol as string, a]));
  let events = 0;

  for (const r of rows) {
    const asset = bySymbol.get(r.symbol);
    if (!asset) continue;
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
      const { sign, magnitude } = classifyRoundResult(delta);
      const headline = `Round ${r.round}: ${asset.name} score ${delta} point${delta === 1 ? '' : 's'} — P${r.position} in the championship (${r.points} pts)`;
      await sql`
        insert into news_events (ts, headline, source, url, asset_id, sign, magnitude)
        values (${now}, ${headline}, 'standings', null, ${asset.id}, ${sign}, ${magnitude})
      `;
      events++;
    }
  }
  return { synced: true, events };
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
