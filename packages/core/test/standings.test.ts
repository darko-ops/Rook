import { describe, expect, it } from 'vitest';
import { classifyRoundResult, CONSTRUCTOR_TO_SYMBOL, F1_TEAMS } from '@rook/core';

describe('round-result classification', () => {
  it('big haul is large positive, blank weekend is negative', () => {
    expect(classifyRoundResult(43)).toEqual({ sign: 1, magnitude: 'large' });
    expect(classifyRoundResult(20)).toEqual({ sign: 1, magnitude: 'medium' });
    expect(classifyRoundResult(8)).toEqual({ sign: 1, magnitude: 'small' });
    expect(classifyRoundResult(2).sign).toBeNull(); // display-only middle
    expect(classifyRoundResult(0)).toEqual({ sign: -1, magnitude: 'medium' });
  });
});

describe('constructor mapping', () => {
  it('every mapped symbol is a launch asset', () => {
    const symbols = new Set(F1_TEAMS.map((t) => t.symbol));
    for (const symbol of Object.values(CONSTRUCTOR_TO_SYMBOL)) {
      expect(symbols.has(symbol), `${symbol} missing from F1_TEAMS`).toBe(true);
    }
  });

  it('covers the full 2026 grid', () => {
    for (const id of ['mercedes', 'ferrari', 'mclaren', 'red_bull', 'alpine', 'rb', 'haas', 'williams', 'audi', 'aston_martin', 'cadillac']) {
      expect(CONSTRUCTOR_TO_SYMBOL[id], `unmapped constructor: ${id}`).toBeDefined();
    }
  });
});
