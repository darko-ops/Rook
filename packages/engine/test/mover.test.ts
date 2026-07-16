import { describe, expect, it } from 'vitest';
import { applyTrade, defaultConfig, HouseMover } from '@rook/engine';
import type { AssetState, NewsEvent } from '@rook/engine';

const mkCfg = () => structuredClone(defaultConfig);
const asset = (supply = 1000): AssetState => ({ id: 'a', supply, reserve: 0 });
const ev = (ts: number, sign: 1 | -1 = 1): NewsEvent => ({
  id: `e${ts}`, ts, assetId: 'a', sign, magnitude: 'medium',
});

describe('house mover', () => {
  it('executes a δ-scaled nudge on a quiet market', () => {
    const cfg = mkCfg();
    const mover = new HouseMover(cfg);
    const d = mover.decide(ev(10), asset());
    expect(d.execute).toBe(true);
    expect(d.delta).toBe(1); // no organic volume → full influence
    expect(d.notional).toBeLessThanOrEqual(cfg.mover.nudgeNotional.medium);
  });

  it('decays to zero as organic volume approaches V*', () => {
    const cfg = mkCfg();
    const mover = new HouseMover(cfg);
    mover.recordUserTrade('a', 5, cfg.mover.vStar / 2, 0.05);
    expect(mover.delta('a', 10)).toBeCloseTo(0.5);
    mover.recordUserTrade('a', 6, cfg.mover.vStar / 2, 0.05);
    expect(mover.delta('a', 10)).toBe(0);
    expect(mover.decide(ev(10), asset()).reason).toBe('zero-delta');
  });

  it('forgets organic volume outside the trailing window', () => {
    const cfg = mkCfg();
    const mover = new HouseMover(cfg);
    mover.recordUserTrade('a', 1, cfg.mover.vStar, 0.05);
    expect(mover.delta('a', 2)).toBe(0);
    expect(mover.delta('a', 2 + cfg.mover.windowTicks)).toBe(1);
  });

  it('rate-limits trades per asset per window', () => {
    const cfg = mkCfg();
    cfg.mover.maxNotionalPerAssetPerWindow = 1e9; // isolate the trade-count limit
    cfg.mover.quietImpactFloor = 10; // isolate from impact cap
    const mover = new HouseMover(cfg);
    let a = asset();
    for (let i = 0; i < cfg.mover.maxTradesPerAssetPerWindow; i++) {
      const d = mover.decide(ev(i), a);
      expect(d.execute).toBe(true);
      const { asset: next, result } = applyTrade(cfg, a, 'buy', d.qty, { skipSizeCap: true });
      a = next;
      mover.recordHouseTrade('a', i, d.notional, result.priceAfter - result.priceBefore);
    }
    expect(mover.decide(ev(20), a).reason).toBe('rate-limited');
  });

  it('caps house impact at the quiet floor when no organic flow', () => {
    const cfg = mkCfg();
    cfg.mover.maxTradesPerAssetPerWindow = 1000;
    cfg.mover.maxNotionalPerAssetPerWindow = 1e9;
    const mover = new HouseMover(cfg);
    let a = asset();
    const startPrice = cfg.curve.p0 + cfg.curve.m * a.supply;
    let houseImpact = 0;
    for (let i = 0; i < 50; i++) {
      const d = mover.decide(ev(i), a);
      if (!d.execute) break;
      const { asset: next, result } = applyTrade(cfg, a, 'buy', d.qty, { skipSizeCap: true });
      a = next;
      houseImpact += result.priceAfter - result.priceBefore;
      mover.recordHouseTrade('a', i, d.notional, result.priceAfter - result.priceBefore);
    }
    // total house impact within one window ≤ quiet floor (± one trade of slack)
    expect(houseImpact).toBeLessThanOrEqual(cfg.mover.quietImpactFloor * startPrice * 1.35);
  });

  it('respects the relative cap C against organic impact', () => {
    const cfg = mkCfg();
    cfg.mover.quietImpactFloor = 0; // isolate the relative cap
    const mover = new HouseMover(cfg);
    const a = asset();
    // organic: small volume (δ stays > 0) with 0.10 price impact this window
    mover.recordUserTrade('a', 1, 500, 0.1);
    const d = mover.decide(ev(2), a);
    expect(d.execute).toBe(true);
    // allowed house impact = C/(1−C) × 0.10; with C=0.3 → ≤ 0.0429
    const impact = cfg.curve.m * d.qty;
    expect(impact).toBeLessThanOrEqual((cfg.mover.capC / (1 - cfg.mover.capC)) * 0.1 + 1e-9);
  });
});
