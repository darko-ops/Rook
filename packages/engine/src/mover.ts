import type { EngineConfig } from './config.js';
import { qtyForCash, qtyForProceeds, spotPrice } from './curve.js';
import type { AssetState, MoverDecision, NewsEvent } from './types.js';

interface FlowRecord {
  ts: number;
  notional: number;
  impact: number; // |priceAfter − priceBefore|
}

interface AssetFlow {
  organic: FlowRecord[];
  house: FlowRecord[];
  houseTradesInWindow: number; // derived on prune, cached for clarity
}

/**
 * House baseline mover. Directional-only: it receives a classified event
 * (asset, sign, magnitude class) and decides whether to execute one small,
 * capped, flagged synthetic trade on the curve in that direction. It never
 * has a target price and never a P&L objective.
 *
 * Constraints enforced here, per §13.2:
 *  1. Directional-only — the only price input is the current spot (for
 *     sizing); the output is a qty in the event's direction.
 *  2. Capped — house share of any window's price movement ≤ capC whenever
 *     traders are active; on quiet windows an absolute impact floor
 *     (quietImpactFloor, a small fraction of price) bounds the house.
 *  3. Decaying — δ(a) = max(0, 1 − V_organic(a)/V*) over the trailing
 *     window; house influence → 0 as organic volume rises.
 *
 * Deterministic and I/O-free: callers feed it trades and events, it returns
 * decisions. Every decision is loggable (MoverDecision is the mover_log row).
 */
export class HouseMover {
  private flows = new Map<string, AssetFlow>();

  constructor(private cfg: EngineConfig) {}

  private flow(assetId: string): AssetFlow {
    let f = this.flows.get(assetId);
    if (!f) {
      f = { organic: [], house: [], houseTradesInWindow: 0 };
      this.flows.set(assetId, f);
    }
    return f;
  }

  private prune(f: AssetFlow, now: number): void {
    const cutoff = now - this.cfg.mover.windowTicks;
    f.organic = f.organic.filter((r) => r.ts > cutoff);
    f.house = f.house.filter((r) => r.ts > cutoff);
    f.houseTradesInWindow = f.house.length;
  }

  recordUserTrade(assetId: string, ts: number, notional: number, impact: number): void {
    this.flow(assetId).organic.push({ ts, notional, impact: Math.abs(impact) });
  }

  recordHouseTrade(assetId: string, ts: number, notional: number, impact: number): void {
    this.flow(assetId).house.push({ ts, notional, impact: Math.abs(impact) });
  }

  /** δ(a) = max(0, 1 − V_organic(a)/V*) over the trailing window. */
  delta(assetId: string, now: number): number {
    const f = this.flow(assetId);
    this.prune(f, now);
    const vOrganic = f.organic.reduce((s, r) => s + r.notional, 0);
    return Math.max(0, 1 - vOrganic / this.cfg.mover.vStar);
  }

  decide(event: NewsEvent, asset: AssetState): MoverDecision {
    const { mover } = this.cfg;
    const f = this.flow(event.assetId);
    this.prune(f, event.ts);

    const none = (reason: MoverDecision['reason']): MoverDecision => ({
      execute: false, qty: 0, notional: 0, delta: 0, reason,
    });

    const delta = this.delta(event.assetId, event.ts);
    if (delta <= 0) return none('zero-delta');

    if (f.houseTradesInWindow >= mover.maxTradesPerAssetPerWindow) {
      return none('rate-limited');
    }
    const houseNotional = f.house.reduce((s, r) => s + r.notional, 0);
    const budget = mover.maxNotionalPerAssetPerWindow - houseNotional;
    if (budget <= 0) return none('budget-exhausted');

    // Cap check: with any real organic flow in the window, the strict
    // relative cap binds alone — house share of the move stays ≤ capC.
    // The quiet floor exists only for dead markets (organic ≈ 0), where
    // "share of the move" is meaningless and overnight liveliness is the
    // mover's whole purpose.
    const price = spotPrice(this.cfg, asset.supply);
    const organicImpact = f.organic.reduce((s, r) => s + r.impact, 0);
    const houseImpact = f.house.reduce((s, r) => s + r.impact, 0);
    const c = mover.capC;
    const floorTerm = mover.quietImpactFloor * price;
    const relativeTerm = (c / (1 - c)) * organicImpact;
    const marketIsDead = organicImpact < floorTerm * 0.5;
    const allowedImpact = marketIsDead ? Math.max(floorTerm, relativeTerm) : relativeTerm;
    const impactHeadroom = allowedImpact - houseImpact;
    if (impactHeadroom <= 0) return none('cap-limited');

    // Size the nudge: class notional × δ, trimmed to budget and impact headroom.
    let notional = Math.min(mover.nudgeNotional[event.magnitude] * delta, budget);
    // Impact of a trade of this notional ≈ m·qty; trim so it fits headroom.
    const maxQtyByImpact = impactHeadroom / Math.max(this.cfg.curve.m, 1e-12);
    let qty =
      event.sign > 0
        ? qtyForCash(this.cfg, asset.supply, notional)
        : qtyForProceeds(this.cfg, asset.supply, notional);
    if (qty > maxQtyByImpact) {
      qty = maxQtyByImpact;
      notional = qty * price; // approximation for the log; execution reprices exactly
    }
    if (qty <= 0 || notional < 1) return none('cap-limited');

    return { execute: true, qty, notional, delta, reason: 'ok' };
  }
}
