import { closeDb } from '@rook/db';
import {
  currentSeason,
  F1_TEAMS,
  ingestNews,
  moverTick,
  scorePendingWindows,
  snapshotPrices,
  SyntheticF1Source,
} from '@rook/core';

/**
 * One full worker cycle, callable with an injected clock: news → mover →
 * snapshots → scores. The daemon calls this on an interval; the dogfood
 * harness calls it hour-by-hour over a simulated half-season. Same code.
 */
export async function tick(now: Date, opts: { newsSeed?: number } = {}): Promise<void> {
  const season = await currentSeason(now);
  if (!season) return;

  // 1. news ingest (synthetic source in dev; real aggregator later, same interface)
  const source = new SyntheticF1Source(new Date(season.starts_at), F1_TEAMS, opts.newsSeed ?? 7);
  const lastHour = new Date(now.getTime() - 3600e3);
  await ingestNews(source, season.id, lastHour, now);

  // 2. house mover consumes fresh classified events
  await moverTick(now);

  // 3. hourly price snapshots (charts, metrics, TWAP, scoring)
  await snapshotPrices(now);

  // 4. fold any completed weekly windows into Rook Scores
  await scorePendingWindows(season.id, now);
}

const isMain = process.argv[1]?.endsWith('tick.ts');
if (isMain) {
  tick(new Date())
    .then(() => closeDb())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
