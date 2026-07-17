import { describe, expect, it } from 'vitest';
import { defaultConfig, isGraduated, routeOrder, spotPrice } from '@rook/engine';
import type { RestingOrder } from '@rook/engine';

const cfg = structuredClone(defaultConfig); // p0=10, m=0.003
const SUPPLY = 1000; // curve spot = 13.00

const order = (o: Partial<RestingOrder>): RestingOrder => ({
  id: 1, userId: 100, side: 'sell', limitPrice: 12, remaining: 50, seq: 1, ...o,
});

describe('hybrid order routing', () => {
  it('fills from the book when the book beats the curve', () => {
    const book = [order({ id: 1, limitPrice: 12.5, remaining: 100 })];
    const r = routeOrder(cfg, 'buy', 40, 999, book, SUPPLY);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]!.qty).toBe(40);
    expect(r.fills[0]!.price).toBe(12.5); // maker's price
    expect(r.curveQty).toBe(0);
    expect(r.unfilled).toBe(0);
  });

  it('price-time priority across levels and seq', () => {
    const book = [
      order({ id: 1, limitPrice: 12.9, seq: 5, remaining: 10 }),
      order({ id: 2, limitPrice: 12.5, seq: 9, remaining: 10 }),
      order({ id: 3, limitPrice: 12.5, seq: 2, remaining: 10 }),
    ];
    const r = routeOrder(cfg, 'buy', 25, 999, book, SUPPLY);
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([3, 2, 1]);
    expect(r.fills[2]!.qty).toBe(5);
  });

  it('falls back to the curve when the book is empty or worse', () => {
    const r = routeOrder(cfg, 'buy', 30, 999, [], SUPPLY);
    expect(r.fills).toHaveLength(0);
    expect(r.curveQty).toBeCloseTo(30, 9);
    expect(r.curveCash).toBeGreaterThan(30 * spotPrice(cfg, SUPPLY));
  });

  it('splits between curve and book at the crossover price', () => {
    // ask sits above current curve price: curve first, then the ask
    const askPrice = spotPrice(cfg, SUPPLY) + 0.15; // curve reaches it after 50 qty
    const book = [order({ id: 7, limitPrice: askPrice, remaining: 1000 })];
    const r = routeOrder(cfg, 'buy', 200, 999, book, SUPPLY);
    expect(r.curveQty).toBeCloseTo(50, 6);
    expect(r.fills[0]!.qty).toBeCloseTo(150, 6);
  });

  it('never matches the taker’s own orders', () => {
    const book = [order({ id: 1, userId: 999, limitPrice: 1 /* absurdly good */ })];
    const r = routeOrder(cfg, 'buy', 10, 999, book, SUPPLY);
    expect(r.fills).toHaveLength(0);
    expect(r.curveQty).toBeCloseTo(10, 9);
  });

  it('sell side: highest bid first, curve fallback, supply floor', () => {
    const book = [
      order({ id: 1, side: 'buy', limitPrice: 13.4, remaining: 20 }),
      order({ id: 2, side: 'buy', limitPrice: 13.1, remaining: 20 }),
    ];
    const r = routeOrder(cfg, 'sell', 60, 999, book, SUPPLY);
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([1, 2]);
    expect(r.curveQty).toBeCloseTo(20, 6);
  });

  it('book-only mode leaves the remainder unfilled', () => {
    const book = [order({ id: 1, limitPrice: 12.5, remaining: 10 })];
    const r = routeOrder(cfg, 'buy', 50, 999, book, SUPPLY, { useCurve: false });
    expect(r.fills[0]!.qty).toBe(10);
    expect(r.unfilled).toBeCloseTo(40, 9);
    expect(r.curveQty).toBe(0);
  });
});

describe('limit-price-aware routing (crossing limit orders)', () => {
  it('a buy limit executes only up to its limit price, remainder unfilled', () => {
    // curve at 13.00; buy limit 13.06 → curve can supply 20 qty before crossing
    const r = routeOrder(cfg, 'buy', 100, 999, [], SUPPLY, { limitPrice: 13.06 });
    expect(r.curveQty).toBeCloseTo(20, 6);
    expect(r.unfilled).toBeCloseTo(80, 6);
  });

  it('ignores book levels beyond the limit', () => {
    const book = [order({ id: 1, limitPrice: 14, remaining: 50 })];
    const r = routeOrder(cfg, 'buy', 10, 999, book, SUPPLY, { limitPrice: 12.5, useCurve: false });
    expect(r.fills).toHaveLength(0);
    expect(r.unfilled).toBe(10);
  });

  it('sell limit below curve fills from curve down to the limit', () => {
    // curve at 13.00; sell limit 12.94 → 20 qty before the curve hits it
    const r = routeOrder(cfg, 'sell', 100, 999, [], SUPPLY, { limitPrice: 12.94 });
    expect(r.curveQty).toBeCloseTo(20, 6);
    expect(r.unfilled).toBeCloseTo(80, 6);
  });
});

describe('graduation measure', () => {
  it('graduates when spread beats AMM slippage for the median trade', () => {
    // median $400 at price 13 → qty ≈ 30.8 → slippage ≈ 0.092
    expect(isGraduated(cfg, 12.98, 13.02, SUPPLY, 400)).toBe(true); // spread 0.04
    expect(isGraduated(cfg, 12.8, 13.2, SUPPLY, 400)).toBe(false); // spread 0.4
    expect(isGraduated(cfg, null, 13.0, SUPPLY, 400)).toBe(false); // one-sided
  });
});
