import { db } from '@rook/db';
import {
  computeWindowPerf,
  eloUpdate,
  type RatingState,
  type Trade,
  type UserWindowPerf,
} from '@rook/engine';
import { loadConfig } from './config.js';
import { loadTimeline, replayUser } from './replay.js';

const HOUR = 3600e3;

/**
 * Score every completed weekly window not yet folded into ratings.
 * Idempotent via score_windows. Returns the number of windows scored.
 */
export async function scorePendingWindows(seasonId: number, now: Date): Promise<number> {
  const sql = db();
  const cfg = await loadConfig(now);
  const [season] = await sql`select * from seasons where id = ${seasonId}`;
  if (!season) return 0;
  const windowMs = cfg.score.windowTicks * HOUR;
  const seasonStart = new Date(season.starts_at).getTime();
  let scored = 0;

  for (let start = seasonStart; start + windowMs <= now.getTime(); start += windowMs) {
    const windowStart = new Date(start);
    const windowEnd = new Date(start + windowMs);
    const [already] = await sql`
      select 1 from score_windows where season_id = ${seasonId} and window_start = ${windowStart}
    `;
    if (already) continue;
    await scoreWindow(seasonId, windowStart, windowEnd, now);
    scored++;
  }
  return scored;
}

async function scoreWindow(
  seasonId: number,
  windowStart: Date,
  windowEnd: Date,
  now: Date,
): Promise<void> {
  const sql = db();
  const cfg = await loadConfig(now);

  // include earliness horizon beyond the window so late trades get context
  const horizonEnd = new Date(windowEnd.getTime() + cfg.score.earlinessHorizon * HOUR);
  const timeline = await loadTimeline(seasonId, windowStart, horizonEnd);
  const windowTickCount = timeline.ticks.filter((t) => t < windowEnd).length;
  if (windowTickCount < 2) {
    await sql`insert into score_windows (season_id, window_start, window_end)
      values (${seasonId}, ${windowStart}, ${windowEnd}) on conflict do nothing`;
    return; // not enough snapshots to score; mark done so we don't loop
  }

  const users = await sql`
    select user_id from balances where season_id = ${seasonId} and joined_at < ${windowEnd}
  `;
  const assets = await sql`select id, symbol from assets where season_id = ${seasonId}`;
  const symbolOf = new Map(assets.map((a) => [a.id as number, a.symbol as string]));

  const windowTrades = await sql`
    select t.* from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId} and t.ts >= ${windowStart} and t.ts < ${windowEnd}
  `;
  const assetGross = new Map<number, number>();
  for (const t of windowTrades) {
    assetGross.set(t.asset_id, (assetGross.get(t.asset_id) ?? 0) + Math.abs(t.cash_delta));
  }

  const t0Hours = timeline.ticks[0]!.getTime() / HOUR;
  const priceAt = (assetIdStr: string, tsHours: number): number => {
    const series = timeline.prices.get(Number(assetIdStr));
    if (!series || series.length === 0) return 0;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(tsHours - t0Hours)));
    return series[i] ?? 0;
  };

  const perfs: UserWindowPerf[] = [];
  for (const u of users) {
    const replay = await replayUser(u.user_id, seasonId, timeline);
    const values = replay.values.slice(0, windowTickCount);
    const trades: Trade[] = windowTrades
      .filter((t) => t.user_id === u.user_id)
      .map((t) => ({
        assetId: String(t.asset_id),
        actor: 'user' as const,
        actorId: String(t.user_id),
        side: t.side,
        ts: new Date(t.ts).getTime() / HOUR,
        qty: t.qty,
        cashDelta: t.cash_delta,
        priceBefore: t.price_before,
        priceAfter: t.price_after,
      }));

    // average weights sampled daily inside the window
    const avgWeights: Record<string, number> = {};
    const sampleIdx: number[] = [];
    for (let i = 0; i < windowTickCount; i += 24) sampleIdx.push(i);
    for (const [assetId, qtySeries] of replay.qty) {
      let w = 0;
      for (const i of sampleIdx) {
        const v = replay.values[i] ?? 0;
        const p = timeline.prices.get(assetId)?.[i] ?? 0;
        if (v > 0) w += ((qtySeries[i] ?? 0) * p) / v;
      }
      if (w > 0) avgWeights[String(assetId)] = w / sampleIdx.length;
    }

    // anti-pump input: user's share of their top asset's window volume
    let topAsset: number | null = null;
    let topW = 0;
    for (const [k, w] of Object.entries(avgWeights)) {
      if (w > topW) {
        topW = w;
        topAsset = Number(k);
      }
    }
    let dominantFlowShare = 0;
    if (topAsset !== null && topW > 0.05) {
      const own = trades
        .filter((t) => t.assetId === String(topAsset))
        .reduce((s, t) => s + Math.abs(t.cashDelta), 0);
      const total = assetGross.get(topAsset) ?? 0;
      dominantFlowShare = total > 0 ? own / total : 0;
    }

    perfs.push(
      computeWindowPerf(
        cfg,
        { userId: String(u.user_id), portfolioValues: values, trades, avgWeights, dominantFlowShare },
        {
          indexValues: timeline.index.slice(0, windowTickCount),
          priceAt,
          windowStart: timeline.ticks[0]!.getTime() / HOUR,
          windowEnd: windowEnd.getTime() / HOUR,
        },
      ),
    );
  }

  // Elo pairwise update against current ratings
  const existing = await sql`select user_id, rook_score, windows_played from scores where season_id = ${seasonId}`;
  const ratings = new Map<string, RatingState>(
    existing.map((r) => [String(r.user_id), { rating: r.rook_score, windowsPlayed: r.windows_played }]),
  );
  eloUpdate(cfg, ratings, perfs);

  await sql.begin(async (tx) => {
    for (const p of perfs) {
      const r = ratings.get(p.userId)!;
      await tx`
        insert into scores (user_id, season_id, rook_score, windows_played, window_stats, updated_at)
        values (${Number(p.userId)}, ${seasonId}, ${r.rating}, ${r.windowsPlayed},
                ${tx.json({ last: { ret: p.ret, excess: p.excess, signal: p.signal, earliness: p.earliness } })}, ${now})
        on conflict (user_id, season_id) do update set
          rook_score = ${r.rating}, windows_played = ${r.windowsPlayed},
          window_stats = scores.window_stats || ${tx.json({
            last: { ret: p.ret, excess: p.excess, signal: p.signal, earliness: p.earliness },
          })},
          updated_at = ${now}
      `;
    }
    await tx`insert into score_windows (season_id, window_start, window_end)
      values (${seasonId}, ${windowStart}, ${windowEnd}) on conflict do nothing`;
  });
}
