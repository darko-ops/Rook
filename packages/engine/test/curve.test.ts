import { describe, expect, it } from 'vitest';
import {
  applyTrade,
  buyCost,
  defaultConfig,
  qtyForCash,
  qtyForProceeds,
  sellProceeds,
  spotPrice,
  TradeError,
} from '@rook/engine';
import type { AssetState } from '@rook/engine';

const cfg = structuredClone(defaultConfig);
const fresh = (): AssetState => ({ id: 'a', supply: 0, reserve: 0 });

describe('linear bonding curve', () => {
  it('prices from p0 at zero supply and rises linearly', () => {
    expect(spotPrice(cfg, 0)).toBe(cfg.curve.p0);
    expect(spotPrice(cfg, 1000)).toBeCloseTo(cfg.curve.p0 + cfg.curve.m * 1000);
  });

  it('buy cost equals the integral under the curve', () => {
    // trapezoid check: cost of q from s = q · avg(price(s), price(s+q))
    const s = 500;
    const q = 40;
    const expected = (q * (spotPrice(cfg, s) + spotPrice(cfg, s + q))) / 2;
    expect(buyCost(cfg, s, q)).toBeCloseTo(expected, 10);
  });

  it('immediate round trip returns exactly what was paid (closed loop)', () => {
    const s = 1234;
    const q = 55;
    expect(sellProceeds(cfg, s + q, q)).toBeCloseTo(buyCost(cfg, s, q), 10);
  });

  it('qtyForCash inverts buyCost; qtyForProceeds inverts sellProceeds', () => {
    const s = 800;
    const cash = 750;
    const q = qtyForCash(cfg, s, cash);
    expect(buyCost(cfg, s, q)).toBeCloseTo(cash, 8);
    const q2 = qtyForProceeds(cfg, s, cash);
    expect(sellProceeds(cfg, s, q2)).toBeCloseTo(cash, 8);
  });

  it('reserve always covers sells by construction', () => {
    let asset = fresh();
    let cashOut = 0;
    let cashIn = 0;
    // random-ish but deterministic buy/sell sequence
    const seq: Array<['buy' | 'sell', number]> = [
      ['buy', 30], ['buy', 50], ['sell', 20], ['buy', 10], ['sell', 60], ['sell', 10],
    ];
    for (const [side, qty] of seq) {
      const { asset: next, result } = applyTrade(cfg, asset, side, qty);
      asset = next;
      if (result.cashDelta < 0) cashIn += -result.cashDelta;
      else cashOut += result.cashDelta;
      expect(asset.reserve).toBeGreaterThanOrEqual(-1e-9);
      expect(asset.reserve).toBeCloseTo(cashIn - cashOut, 8);
    }
    expect(asset.supply).toBe(0);
    expect(asset.reserve).toBeCloseTo(0, 8);
  });

  it('enforces the per-trade size cap', () => {
    const asset = fresh();
    const qTooBig = qtyForCash(cfg, 0, cfg.trading.maxTradeNotional + 100);
    expect(() => applyTrade(cfg, asset, 'buy', qTooBig)).toThrow(TradeError);
    expect(() => applyTrade(cfg, asset, 'buy', qTooBig, { skipSizeCap: true })).not.toThrow();
  });

  it('rejects selling more than supply and non-positive qty', () => {
    const asset = fresh();
    expect(() => applyTrade(cfg, asset, 'sell', 1)).toThrow(TradeError);
    expect(() => applyTrade(cfg, asset, 'buy', 0)).toThrow(TradeError);
    expect(() => applyTrade(cfg, asset, 'buy', NaN)).toThrow(TradeError);
  });
});
