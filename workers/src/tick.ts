import { closeDb } from '@rook/db';
import {
  copyTick,
  currentSeason,
  F1_TEAMS,
  ingestNews,
  moverTick,
  newsSourceFor,
  pushTick,
  scorePendingWindows,
  snapshotPrices,
  syncStandings,
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

  // 1. news ingest — source comes from versioned config ('synthetic' | 'rss');
  //    the dogfood harness pins the synthetic source for determinism
  const source =
    opts.newsSeed !== undefined
      ? new SyntheticF1Source(new Date(season.starts_at), F1_TEAMS, opts.newsSeed)
      : await newsSourceFor({ id: season.id, starts_at: new Date(season.starts_at) }, now);
  const lookback = new Date(now.getTime() - (opts.newsSeed !== undefined ? 1 : 6) * 3600e3);
  await ingestNews(source, season.id, lookback, now);

  // 1b. real standings sync (display + round-result events; throttled 4h;
  //     skipped in deterministic dogfood runs)
  if (opts.newsSeed === undefined) {
    await syncStandings(season.id, now);
  }

  // 2. house mover consumes fresh classified events
  await moverTick(now);

  // 3. hourly price snapshots (charts, metrics, TWAP, scoring)
  await snapshotPrices(now);

  // 3b. replicate leader trades for copiers (cursor-based, best-effort)
  if (opts.newsSeed === undefined) {
    await copyTick(season.id, now);
  }

  // 4. fold any completed weekly windows into Rook Scores
  await scorePendingWindows(season.id, now);

  // 5. "your portfolio moved" pushes (cooldown-gated; skipped in dogfood)
  if (opts.newsSeed === undefined) {
    await pushTick(season.id, now);
  }
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
