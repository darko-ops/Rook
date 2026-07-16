import type { MagnitudeClass } from './types.js';

/**
 * Every tunable in one place. In v1 these live in the versioned `config`
 * table; the engine only ever reads them from this object.
 */
export interface EngineConfig {
  curve: {
    p0: number; // identical base price for all assets at season start
    m: number; // steepness — THE tunable (sweep in Phase 0)
  };
  trading: {
    maxTradeNotional: number; // per-trade size cap (anti-whipsaw), play-$
    startingStack: number; // equal stack per user per season
  };
  mover: {
    // Nudge notional per event magnitude class, before δ scaling.
    nudgeNotional: Record<MagnitudeClass, number>;
    capC: number; // hard cap on house share of any window's move
    vStar: number; // organic-volume threshold where δ(a) hits 0 (notional/window)
    maxTradesPerAssetPerWindow: number;
    maxNotionalPerAssetPerWindow: number;
    // Floor on allowed house price impact per window when organic flow is ~0
    // (fraction of price). Keeps quiet nights alive without letting the
    // house set prices: the relative cap C binds whenever traders are active.
    quietImpactFloor: number;
    windowTicks: number; // window length for caps/rate limits/decay volume
  };
  score: {
    windowTicks: number; // scoring window length
    eloK: number; // base K-factor
    provisionalWindows: number; // windows with elevated K for new users
    provisionalKMultiplier: number;
    initialRating: number;
    volFloor: number; // floor on portfolio vol in risk adjustment
    earlinessHorizon: number; // ticks after a trade to measure the move it led
    earlinessLookback: number; // ticks before a trade to measure chased momentum
    concentrationHhiThreshold: number; // HHI above this scales positive perf down
    concentrationPenalty: number; // multiplier applied above threshold
    concentrationTax: number; // flat reputation cost per window for reckless books
    washWindow: number; // ticks within which offsetting round-trips are wash
    washNetPositionTolerance: number; // |net qty| / gross qty below this = wash
    washPenaltyWeight: number; // detected wash volume actively costs rating
    minVolumeForFullWeight: number; // window notional below this scales signal down
    // Anti-pump: if a user's own flow is more than this share of their top
    // asset's window volume, positive performance on it is discounted —
    // you can't earn reputation for a move you mostly caused yourself.
    dominantFlowThreshold: number;
  };
}

export const defaultConfig: EngineConfig = {
  curve: { p0: 10, m: 0.002 },
  trading: { maxTradeNotional: 1000, startingStack: 10_000 },
  mover: {
    nudgeNotional: { small: 150, medium: 400, large: 900 },
    capC: 0.3,
    vStar: 5000,
    maxTradesPerAssetPerWindow: 6,
    maxNotionalPerAssetPerWindow: 1800,
    quietImpactFloor: 0.015,
    windowTicks: 24,
  },
  score: {
    windowTicks: 168, // weekly at hourly ticks
    eloK: 32,
    provisionalWindows: 3,
    provisionalKMultiplier: 2,
    initialRating: 1200,
    volFloor: 0.005,
    earlinessHorizon: 48,
    earlinessLookback: 24,
    concentrationHhiThreshold: 0.5,
    concentrationPenalty: 0.5,
    concentrationTax: 0.4,
    washWindow: 48,
    washNetPositionTolerance: 0.2,
    washPenaltyWeight: 2,
    minVolumeForFullWeight: 500,
    dominantFlowThreshold: 0.25,
  },
};
