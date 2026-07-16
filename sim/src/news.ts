import type { MagnitudeClass, NewsEvent } from '@rook/engine';
import { Rng } from './rng.js';

export const TICKS_PER_DAY = 24;

export interface SimEvent extends NewsEvent {
  /** How strongly the crowd will eventually react (scales noise-trader flow). */
  crowdWeight: number;
}

const CROWD_WEIGHT: Record<MagnitudeClass, number> = { small: 0.5, medium: 1, large: 2 };

/**
 * Season news stream on an F1-ish cadence: a race weekend every 14 days
 * (quali events Saturday, result events Sunday), plus a trickle of midweek
 * news (penalties, technical directives, driver-market noise).
 */
export function generateSeason(
  rng: Rng,
  assetIds: string[],
  seasonDays: number,
): SimEvent[] {
  const events: SimEvent[] = [];
  let id = 0;
  const push = (ts: number, assetId: string, sign: 1 | -1, magnitude: MagnitudeClass) => {
    events.push({ id: `n${id++}`, ts, assetId, sign, magnitude, crowdWeight: CROWD_WEIGHT[magnitude] });
  };

  for (let day = 0; day < seasonDays; day++) {
    const dayStart = day * TICKS_PER_DAY;
    const raceCycleDay = day % 14;

    if (raceCycleDay === 6) {
      // qualifying: medium events for a few teams
      for (const a of assetIds) {
        if (rng.chance(0.4)) push(dayStart + 14 + rng.int(0, 3), a, rng.sign(), 'medium');
      }
    } else if (raceCycleDay === 7) {
      // race result: every team gets an event; a few are large
      for (const a of assetIds) {
        const magnitude: MagnitudeClass = rng.chance(0.3) ? 'large' : 'medium';
        push(dayStart + 15 + rng.int(0, 2), a, rng.sign(), magnitude);
      }
    } else {
      // midweek trickle: ~1.2 events/day league-wide
      const n = rng.chance(0.7) ? 1 : rng.chance(0.5) ? 2 : 0;
      for (let i = 0; i < n; i++) {
        const magnitude: MagnitudeClass = rng.chance(0.25) ? 'medium' : 'small';
        push(dayStart + rng.int(8, 22), rng.pick(assetIds), rng.sign(), magnitude);
      }
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}
