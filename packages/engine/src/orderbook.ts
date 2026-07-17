import type { EngineConfig } from './config.js';
import { buyCost, sellProceeds, spotPrice } from './curve.js';
import type { Side } from './types.js';

/**
 * Limit order book with hybrid routing against the bonding curve (§25).
 * Pure matching logic: the caller owns persistence, escrow, and locks.
 *
 * Routing rule for a marketable order: consume the book while its marginal
 * price beats the curve's marginal price, otherwise take from the curve —
 * the AMM remains backstop liquidity, so graduation is emergent (a routing
 * fact you can measure) rather than a switch that can strand an asset.
 */

export interface RestingOrder {
  id: number;
  userId: number;
  side: Side;
  limitPrice: number;
  remaining: number;
  seq: number; // time priority within a price level
}

export interface Fill {
  makerOrderId: number;
  makerUserId: number;
  qty: number;
  price: number; // maker's limit price (price-time priority, maker earns spread)
}

export interface RouteResult {
  fills: Fill[];
  /** qty taken from (buy) or sold to (sell) the curve */
  curveQty: number;
  /** cash paid to (buy) / received from (sell) the curve, positive number */
  curveCash: number;
  /** qty left unfilled (only when the caller disallows the curve fallback) */
  unfilled: number;
}

function sortBook(side: Side, book: RestingOrder[]): RestingOrder[] {
  // opposite side book, best price first, then time
  return [...book].sort((a, b) =>
    side === 'buy'
      ? a.limitPrice - b.limitPrice || a.seq - b.seq // taker buys: cheapest ask first
      : b.limitPrice - a.limitPrice || a.seq - b.seq, // taker sells: highest bid first
  );
}

/**
 * Route a marketable order of `qty` for `takerUserId` against the resting
 * opposite-side `book` and the curve at `supply`. Never matches the taker's
 * own orders (self-trade prevention: those entries are skipped, not
 * cancelled). `useCurve: false` restricts to the book (used when filling a
 * crossing limit order — the leftover rests instead of hitting the curve).
 */
export function routeOrder(
  cfg: EngineConfig,
  side: Side,
  qty: number,
  takerUserId: number,
  book: RestingOrder[],
  supply: number,
  opts: { useCurve?: boolean; limitPrice?: number } = {},
): RouteResult {
  const useCurve = opts.useCurve !== false;
  const limit = opts.limitPrice;
  const withinLimit = (price: number): boolean =>
    limit === undefined || (side === 'buy' ? price <= limit + 1e-12 : price >= limit - 1e-12);
  const fills: Fill[] = [];
  let remaining = qty;
  let curveQty = 0;
  let curveCash = 0;
  let virtualSupply = supply;

  const queue = sortBook(side, book).filter((o) => o.userId !== takerUserId && o.remaining > 1e-9);
  let qi = 0;

  while (remaining > 1e-9) {
    const best = queue[qi];
    const curveMarginal = spotPrice(cfg, virtualSupply);
    const bookBetter =
      best !== undefined &&
      withinLimit(best.limitPrice) &&
      (side === 'buy' ? best.limitPrice <= curveMarginal || !useCurve
                      : best.limitPrice >= curveMarginal || !useCurve);

    if (best && bookBetter) {
      const take = Math.min(remaining, best.remaining);
      fills.push({ makerOrderId: best.id, makerUserId: best.userId, qty: take, price: best.limitPrice });
      remaining -= take;
      best.remaining -= take;
      if (best.remaining <= 1e-9) qi++;
      continue;
    }
    if (!useCurve) break;
    if (!withinLimit(curveMarginal)) break; // curve already past the limit

    // take from the curve up to the nearer of: the book's next price level,
    // or the taker's own limit price
    let curveChunk = remaining;
    const targets: number[] = [];
    if (best) targets.push(best.limitPrice);
    if (limit !== undefined) targets.push(limit);
    if (targets.length > 0) {
      const target = side === 'buy' ? Math.min(...targets) : Math.max(...targets);
      const dq = Math.abs(target - curveMarginal) / Math.max(cfg.curve.m, 1e-12);
      curveChunk = Math.min(remaining, Math.max(dq, 1e-9));
    }
    if (side === 'buy') {
      curveCash += buyCost(cfg, virtualSupply, curveChunk);
      virtualSupply += curveChunk;
    } else {
      if (curveChunk > virtualSupply) curveChunk = virtualSupply;
      if (curveChunk <= 1e-9) break; // nothing left to sell against
      curveCash += sellProceeds(cfg, virtualSupply, curveChunk);
      virtualSupply -= curveChunk;
    }
    curveQty += curveChunk;
    remaining -= curveChunk;
  }

  return { fills, curveQty, curveCash, unfilled: remaining };
}

/**
 * Graduation measure (§25): an asset has graduated when its top-of-book
 * spread beats the AMM's round-trip slippage for the median trade size.
 * Informational — routing is already hybrid everywhere.
 */
export function isGraduated(
  cfg: EngineConfig,
  bestBid: number | null,
  bestAsk: number | null,
  supply: number,
  medianTradeNotional: number,
): boolean {
  if (bestBid === null || bestAsk === null || bestAsk <= bestBid) return false;
  const spread = bestAsk - bestBid;
  const price = spotPrice(cfg, supply);
  if (price <= 0) return false;
  const qty = medianTradeNotional / price;
  const ammSlippage = cfg.curve.m * qty; // price impact of the median trade
  return spread < ammSlippage;
}
