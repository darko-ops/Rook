import { db } from '@rook/db';
import type { MagnitudeClass } from '@rook/engine';
import { Rng } from './rng.js';

/**
 * v1 needs a news *feed* for traders to react to, not a pricing feed
 * (§13.3). Sources implement this interface; the mover consumes only the
 * coarse classification (sign + magnitude class).
 */
export interface ClassifiedNews {
  ts: Date;
  headline: string;
  source: string;
  url?: string;
  symbol: string; // asset tag
  sign: 1 | -1;
  magnitude: MagnitudeClass;
}

export interface NewsSource {
  fetchSince(since: Date, until: Date): Promise<ClassifiedNews[]>;
}

const GOOD: Array<[string, MagnitudeClass]> = [
  ['{team} take pole position in commanding qualifying display', 'medium'],
  ['{team} win from lights to flag', 'large'],
  ['{team} double podium caps strong weekend', 'large'],
  ['{team} confirm major upgrade package passed crash tests', 'medium'],
  ['{team} extend star driver through 2028', 'medium'],
  ['Paddock sources: {team} floor upgrade worth three tenths', 'small'],
  ['{team} top second practice on race sim pace', 'small'],
];
const BAD: Array<[string, MagnitudeClass]> = [
  ['Double DNF disaster for {team}', 'large'],
  ['{team} hit with grid penalty after technical infringement', 'medium'],
  ['{team} lose team principal in shock exit', 'medium'],
  ['Q1 exit for both {team} cars', 'medium'],
  ['{team} upgrade package fails to deliver in testing', 'small'],
  ['Reliability worries resurface at {team}', 'small'],
];

/**
 * Synthetic F1-cadence source for dev and the dogfood half-season: race
 * weekend every 14 days (quali Saturday, results Sunday), midweek trickle.
 * Deterministic per seed. Swap for a real aggregator behind the same
 * interface (R6: price per-league data cost before EPL).
 */
export class SyntheticF1Source implements NewsSource {
  private symbols: string[];

  constructor(
    private seasonStart: Date,
    private teams: Array<{ symbol: string; name: string }>,
    private seed = 7,
  ) {
    this.symbols = teams.map((t) => t.symbol);
  }

  private nameOf(symbol: string): string {
    return this.teams.find((t) => t.symbol === symbol)?.name ?? symbol;
  }

  async fetchSince(since: Date, until: Date): Promise<ClassifiedNews[]> {
    const out: ClassifiedNews[] = [];
    const dayMs = 86400e3;
    const firstDay = Math.max(0, Math.floor((since.getTime() - this.seasonStart.getTime()) / dayMs));
    const lastDay = Math.floor((until.getTime() - this.seasonStart.getTime()) / dayMs);
    for (let day = firstDay; day <= lastDay; day++) {
      const rng = new Rng(this.seed ^ (day * 2654435761));
      const dayStart = this.seasonStart.getTime() + day * dayMs;
      const cycle = day % 14;
      const emit = (hour: number, symbol: string, sign: 1 | -1, tmpl: [string, MagnitudeClass]) => {
        const ts = new Date(dayStart + hour * 3600e3);
        if (ts < since || ts >= until) return;
        out.push({
          ts,
          headline: tmpl[0].replace('{team}', this.nameOf(symbol)),
          source: 'synthetic-f1',
          symbol,
          sign,
          magnitude: tmpl[1],
        });
      };
      if (cycle === 6) {
        for (const s of this.symbols) {
          if (!rng.chance(0.4)) continue;
          const sign = rng.sign();
          const pool = sign > 0 ? GOOD : BAD;
          emit(14 + rng.int(0, 3), s, sign, pool[rng.int(0, pool.length)]!);
        }
      } else if (cycle === 7) {
        for (const s of this.symbols) {
          const sign = rng.sign();
          const pool = (sign > 0 ? GOOD : BAD).filter(
            ([, m]) => m === (rng.chance(0.3) ? 'large' : 'medium'),
          );
          if (pool.length > 0) emit(15 + rng.int(0, 2), s, sign, pool[rng.int(0, pool.length)]!);
        }
      } else {
        const n = rng.chance(0.7) ? 1 : rng.chance(0.5) ? 2 : 0;
        for (let i = 0; i < n; i++) {
          const sign = rng.sign();
          const pool = (sign > 0 ? GOOD : BAD).filter(
            ([, m]) => m === (rng.chance(0.25) ? 'medium' : 'small'),
          );
          if (pool.length > 0) {
            emit(rng.int(8, 22), this.symbols[rng.int(0, this.symbols.length)]!, sign, pool[rng.int(0, pool.length)]!);
          }
        }
      }
    }
    return out.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
}

/** Pull from a source and append to news_events, tagged per asset. */
export async function ingestNews(
  source: NewsSource,
  seasonId: number,
  since: Date,
  until: Date,
): Promise<number> {
  const sql = db();
  const items = await source.fetchSince(since, until);
  if (items.length === 0) return 0;
  const assets = await sql`select id, symbol from assets where season_id = ${seasonId}`;
  const bySymbol = new Map(assets.map((a) => [a.symbol as string, a.id as number]));
  let n = 0;
  for (const item of items) {
    const assetId = bySymbol.get(item.symbol);
    if (!assetId) continue;
    await sql`
      insert into news_events (ts, headline, source, url, asset_id, sign, magnitude)
      values (${item.ts}, ${item.headline}, ${item.source}, ${item.url ?? null},
              ${assetId}, ${item.sign}, ${item.magnitude})
    `;
    n++;
  }
  return n;
}
