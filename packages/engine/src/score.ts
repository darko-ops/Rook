import type { EngineConfig } from './config.js';
import type { Trade } from './types.js';

/**
 * Rook Score — market reputation, first cut (Phase 0 deliverable).
 *
 * Every input is a market-activity observable: positions, prices, timing,
 * flow. Nothing here predicts sport.
 *
 * Per scoring window each user gets a performance signal:
 *   signal = riskAdjustedExcess × earliness × volumeWeight [× concPenalty]
 * then ratings move by Elo-style pairwise update against the field.
 */

export interface UserWindowInput {
  userId: string;
  /** Portfolio value (cash + holdings marked to spot) sampled each tick. */
  portfolioValues: number[];
  /** This user's trades inside the window. */
  trades: Trade[];
  /** Average portfolio weight per asset over the window (vs total value). */
  avgWeights: Record<string, number>;
  /**
   * Share of the user's top-weight asset's window volume that is the user's
   * own flow (anti-pump input; caller computes it from the trade log).
   */
  dominantFlowShare?: number;
}

export interface WindowMarketInput {
  /** Rook Index (cap-weighted league price index) sampled each tick. */
  indexValues: number[];
  /** Spot price lookup, must cover [windowStart − lookback, windowEnd + horizon]. */
  priceAt: (assetId: string, ts: number) => number;
  windowStart: number;
  windowEnd: number;
}

export interface UserWindowPerf {
  userId: string;
  ret: number;
  excess: number;
  vol: number;
  riskAdjusted: number;
  earliness: number; // multiplier ∈ [0.75, 1.25]
  washFraction: number;
  volumeWeight: number; // ∈ [0, 1]
  hhi: number;
  signal: number;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function tickReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev > 0) out.push(values[i]! / prev - 1);
  }
  return out;
}

/**
 * Wash detection: per user-asset bucket of trades within washWindow of each
 * other, if |net qty| is a small fraction of gross qty, the offsetting
 * portion is wash volume and earns no volume credit.
 */
export function washNotional(cfg: EngineConfig, trades: Trade[]): { gross: number; wash: number } {
  const s = cfg.score;
  const byAsset = new Map<string, Trade[]>();
  for (const t of trades) {
    (byAsset.get(t.assetId) ?? byAsset.set(t.assetId, []).get(t.assetId)!).push(t);
  }
  let gross = 0;
  let wash = 0;
  for (const ts of byAsset.values()) {
    const sorted = [...ts].sort((a, b) => a.ts - b.ts);
    let i = 0;
    while (i < sorted.length) {
      // cluster trades within washWindow of the cluster start
      const start = sorted[i]!.ts;
      let j = i;
      while (j < sorted.length && sorted[j]!.ts - start <= s.washWindow) j++;
      const cluster = sorted.slice(i, j);
      const grossQty = cluster.reduce((a, t) => a + t.qty, 0);
      const netQty = Math.abs(
        cluster.reduce((a, t) => a + (t.side === 'buy' ? t.qty : -t.qty), 0),
      );
      const notional = cluster.reduce((a, t) => a + Math.abs(t.cashDelta), 0);
      gross += notional;
      if (grossQty > 0 && netQty / grossQty < s.washNetPositionTolerance) {
        wash += notional * (1 - netQty / grossQty);
      }
      i = j;
    }
  }
  return { gross, wash };
}

/**
 * Earliness: for each trade, compare the aligned move after the trade
 * (what the position captured) with the aligned move before it (momentum it
 * chased). Lead share ∈ [−1, 1]; profit on positions opened before the move
 * scores high, momentum-chasing scores ~0, fading into losses scores < 0.
 */
export function earlinessFactor(
  cfg: EngineConfig,
  trades: Trade[],
  priceAt: (assetId: string, ts: number) => number,
): number {
  const s = cfg.score;
  let weighted = 0;
  let totalW = 0;
  for (const t of trades) {
    const dir = t.side === 'buy' ? 1 : -1;
    const pAt = priceAt(t.assetId, t.ts);
    const pAfter = priceAt(t.assetId, t.ts + s.earlinessHorizon);
    const pBefore = priceAt(t.assetId, Math.max(0, t.ts - s.earlinessLookback));
    if (pAt <= 0 || pBefore <= 0) continue;
    const after = dir * (pAfter / pAt - 1);
    const before = dir * (pAt / pBefore - 1);
    const lead = after / (Math.abs(after) + Math.abs(before) + 1e-6);
    // scale by how material the subsequent move was, so lead on flat prices
    // doesn't dominate
    const materiality = Math.min(1, Math.abs(pAfter / pAt - 1) / 0.02);
    const w = Math.abs(t.cashDelta) * materiality;
    weighted += Math.max(-1, Math.min(1, lead)) * w;
    totalW += Math.abs(t.cashDelta);
  }
  if (totalW === 0) return 1;
  return 1 + 0.25 * (weighted / totalW);
}

export function computeWindowPerf(
  cfg: EngineConfig,
  user: UserWindowInput,
  market: WindowMarketInput,
): UserWindowPerf {
  const s = cfg.score;
  const v0 = user.portfolioValues[0] ?? 0;
  const v1 = user.portfolioValues[user.portfolioValues.length - 1] ?? 0;
  const i0 = market.indexValues[0] ?? 1;
  const i1 = market.indexValues[market.indexValues.length - 1] ?? 1;
  const ret = v0 > 0 ? v1 / v0 - 1 : 0;
  const indexRet = i0 > 0 ? i1 / i0 - 1 : 0;
  const excess = ret - indexRet;
  const vol = stdev(tickReturns(user.portfolioValues)) * Math.sqrt(user.portfolioValues.length);
  const riskAdjusted = excess / Math.max(vol, s.volFloor);

  const { gross, wash } = washNotional(cfg, user.trades);
  const washFraction = gross > 0 ? wash / gross : 0;
  const creditedNotional = gross - wash;
  const volumeWeight = Math.min(1, creditedNotional / s.minVolumeForFullWeight);

  const earliness = earlinessFactor(cfg, user.trades, market.priceAt);

  const hhi = Object.values(user.avgWeights).reduce((a, w) => a + w * w, 0);
  // Earliness scales gains up when early; when performance is negative the
  // multiplier flips (2 − E) so being late AND wrong is worse, never better.
  let signal =
    (riskAdjusted >= 0 ? riskAdjusted * earliness : riskAdjusted * (2 - earliness)) *
    volumeWeight;
  if (hhi > s.concentrationHhiThreshold) {
    if (signal > 0) signal *= s.concentrationPenalty;
    // Recklessness is a reputation cost even when the coin lands heads:
    // rewarding survived concentration is exactly risk R4.
    signal -= (hhi - s.concentrationHhiThreshold) * s.concentrationTax;
  }
  // Anti-pump: discount gains on a move the user's own flow dominated.
  const dfs = user.dominantFlowShare ?? 0;
  if (dfs > s.dominantFlowThreshold && signal > 0) {
    signal *= Math.max(0, 1 - (dfs - s.dominantFlowThreshold) / (1 - s.dominantFlowThreshold));
  }
  // Wash volume is not merely uncredited — it costs reputation.
  signal -= washFraction * s.washPenaltyWeight;
  return { userId: user.userId, ret, excess, vol, riskAdjusted, earliness, washFraction, volumeWeight, hhi, signal };
}

export interface RatingState {
  rating: number;
  windowsPlayed: number;
}

/** Elo-style pairwise update across the whole field for one scoring window. */
export function eloUpdate(
  cfg: EngineConfig,
  ratings: Map<string, RatingState>,
  perfs: UserWindowPerf[],
): void {
  const s = cfg.score;
  const n = perfs.length;
  if (n < 2) return;
  const get = (id: string): RatingState => {
    let r = ratings.get(id);
    if (!r) {
      r = { rating: s.initialRating, windowsPlayed: 0 };
      ratings.set(id, r);
    }
    return r;
  };
  const deltas = new Map<string, number>();
  for (const a of perfs) {
    const ra = get(a.userId);
    const k = ra.windowsPlayed < s.provisionalWindows ? s.eloK * s.provisionalKMultiplier : s.eloK;
    let sum = 0;
    for (const b of perfs) {
      if (a.userId === b.userId) continue;
      const rb = get(b.userId);
      const expected = 1 / (1 + 10 ** ((rb.rating - ra.rating) / 400));
      const actual = a.signal > b.signal ? 1 : a.signal < b.signal ? 0 : 0.5;
      sum += actual - expected;
    }
    deltas.set(a.userId, (k * sum) / (n - 1));
  }
  for (const [id, d] of deltas) {
    const r = get(id);
    r.rating += d;
    r.windowsPlayed += 1;
  }
}
