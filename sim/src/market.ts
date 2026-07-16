import {
  applyTrade,
  HouseMover,
  qtyForCash,
  qtyForProceeds,
  spotPrice,
} from '@rook/engine';
import type { AssetState, EngineConfig, Side, Trade } from '@rook/engine';

/**
 * Sim-side market state: assets on the curve, agent balances/holdings, the
 * append-only trade log, and the house mover fed with every trade — the same
 * wiring the v1 trade path will have.
 */
export class Market {
  assets = new Map<string, AssetState>();
  cash = new Map<string, number>();
  holdings = new Map<string, Map<string, number>>();
  trades: Trade[] = [];
  mover: HouseMover;

  constructor(
    public cfg: EngineConfig,
    assetIds: string[],
    agentIds: string[],
  ) {
    for (const id of assetIds) this.assets.set(id, { id, supply: 0, reserve: 0 });
    for (const id of agentIds) {
      this.cash.set(id, cfg.trading.startingStack);
      this.holdings.set(id, new Map());
    }
    this.mover = new HouseMover(cfg);
  }

  price(assetId: string): number {
    return spotPrice(this.cfg, this.assets.get(assetId)!.supply);
  }

  holding(agentId: string, assetId: string): number {
    return this.holdings.get(agentId)?.get(assetId) ?? 0;
  }

  portfolioValue(agentId: string): number {
    let v = this.cash.get(agentId) ?? 0;
    for (const [assetId, qty] of this.holdings.get(agentId) ?? []) {
      v += qty * this.price(assetId);
    }
    return v;
  }

  /** Cap-weighted league index, normalized elsewhere. */
  marketCap(): number {
    let cap = 0;
    for (const a of this.assets.values()) cap += a.supply * spotPrice(this.cfg, a.supply);
    return cap;
  }

  /**
   * Best-effort user trade for a target notional: trims to the per-trade size
   * cap, available cash / holdings. Returns the executed trade or null.
   */
  tryUserTrade(agentId: string, assetId: string, side: Side, notional: number, ts: number): Trade | null {
    const asset = this.assets.get(assetId)!;
    const cap = this.cfg.trading.maxTradeNotional * 0.999; // stay strictly under
    let qty: number;
    if (side === 'buy') {
      const spend = Math.min(notional, cap, this.cash.get(agentId) ?? 0);
      if (spend < 1) return null;
      qty = qtyForCash(this.cfg, asset.supply, spend);
    } else {
      const held = this.holding(agentId, assetId);
      if (held <= 0) return null;
      qty = Math.min(held, qtyForProceeds(this.cfg, asset.supply, Math.min(notional, cap)));
    }
    if (qty <= 1e-9) return null;
    const { asset: next, result } = applyTrade(this.cfg, asset, side, qty);
    this.assets.set(assetId, next);
    this.cash.set(agentId, (this.cash.get(agentId) ?? 0) + result.cashDelta);
    const h = this.holdings.get(agentId)!;
    h.set(assetId, (h.get(assetId) ?? 0) + (side === 'buy' ? qty : -qty));
    const trade: Trade = { ...result, assetId, actor: 'user', actorId: agentId, side, ts };
    this.trades.push(trade);
    this.mover.recordUserTrade(assetId, ts, Math.abs(result.cashDelta), result.priceAfter - result.priceBefore);
    return trade;
  }

  /** House mover trade: no balance, no size cap (its own budget binds), flagged. */
  houseTrade(assetId: string, side: Side, qty: number, ts: number): Trade | null {
    const asset = this.assets.get(assetId)!;
    if (side === 'sell') qty = Math.min(qty, asset.supply);
    if (qty <= 1e-9) return null;
    const { asset: next, result } = applyTrade(this.cfg, asset, side, qty, { skipSizeCap: true });
    this.assets.set(assetId, next);
    const trade: Trade = { ...result, assetId, actor: 'house', actorId: 'house', side, ts };
    this.trades.push(trade);
    this.mover.recordHouseTrade(assetId, ts, Math.abs(result.cashDelta), result.priceAfter - result.priceBefore);
    return trade;
  }
}
