import type { EngineConfig } from './config.js';
import type { AssetState, Side, TradeResult } from './types.js';

/** Spot price on the linear bonding curve: price(s) = p0 + m·s */
export function spotPrice(cfg: EngineConfig, supply: number): number {
  return cfg.curve.p0 + cfg.curve.m * supply;
}

/** Cost to buy qty starting from `supply`: ∫ price = q·p0 + m·(s·q + q²/2) */
export function buyCost(cfg: EngineConfig, supply: number, qty: number): number {
  const { p0, m } = cfg.curve;
  return qty * p0 + m * (supply * qty + (qty * qty) / 2);
}

/** Proceeds from selling qty back onto the curve (same integral, reversed). */
export function sellProceeds(cfg: EngineConfig, supply: number, qty: number): number {
  const { p0, m } = cfg.curve;
  return qty * p0 + m * (supply * qty - (qty * qty) / 2);
}

/** Quantity purchasable with `cash` from `supply` (inverse of buyCost). */
export function qtyForCash(cfg: EngineConfig, supply: number, cash: number): number {
  const { p0, m } = cfg.curve;
  if (cash <= 0) return 0;
  const b = p0 + m * supply; // current spot price
  if (m === 0) return cash / b;
  // (m/2)q² + b·q − cash = 0
  return (-b + Math.sqrt(b * b + 2 * m * cash)) / m;
}

/** Quantity to sell to raise `cash` (inverse of sellProceeds); capped at supply. */
export function qtyForProceeds(cfg: EngineConfig, supply: number, cash: number): number {
  const { p0, m } = cfg.curve;
  if (cash <= 0) return 0;
  const b = p0 + m * supply;
  if (m === 0) return cash / b;
  // −(m/2)q² + b·q − cash = 0 → smaller root
  const disc = b * b - 2 * m * cash;
  if (disc < 0) return supply; // can't raise that much; sell everything
  return Math.min(supply, (b - Math.sqrt(disc)) / m);
}

export class TradeError extends Error {
  constructor(
    readonly code: 'size-cap' | 'insufficient-supply' | 'bad-qty',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Execute a trade against the curve, mutating nothing: returns the new asset
 * state and the trade result. Enforces the per-trade size cap.
 */
export function applyTrade(
  cfg: EngineConfig,
  asset: AssetState,
  side: Side,
  qty: number,
  opts: { skipSizeCap?: boolean } = {},
): { asset: AssetState; result: TradeResult } {
  if (!(qty > 0) || !Number.isFinite(qty)) {
    throw new TradeError('bad-qty', `qty must be positive, got ${qty}`);
  }
  const priceBefore = spotPrice(cfg, asset.supply);
  if (side === 'buy') {
    const cost = buyCost(cfg, asset.supply, qty);
    if (!opts.skipSizeCap && cost > cfg.trading.maxTradeNotional) {
      throw new TradeError('size-cap', `buy notional ${cost.toFixed(2)} exceeds cap`);
    }
    const supply = asset.supply + qty;
    return {
      asset: { ...asset, supply, reserve: asset.reserve + cost },
      result: { qty, cashDelta: -cost, priceBefore, priceAfter: spotPrice(cfg, supply) },
    };
  }
  if (qty > asset.supply + 1e-9) {
    throw new TradeError('insufficient-supply', `sell ${qty} > supply ${asset.supply}`);
  }
  const proceeds = sellProceeds(cfg, asset.supply, qty);
  if (!opts.skipSizeCap && proceeds > cfg.trading.maxTradeNotional) {
    throw new TradeError('size-cap', `sell notional ${proceeds.toFixed(2)} exceeds cap`);
  }
  const supply = asset.supply - qty;
  return {
    asset: { ...asset, supply, reserve: asset.reserve - proceeds },
    result: { qty, cashDelta: proceeds, priceBefore, priceAfter: spotPrice(cfg, supply) },
  };
}
