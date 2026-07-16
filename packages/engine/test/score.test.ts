import { describe, expect, it } from 'vitest';
import {
  computeWindowPerf,
  defaultConfig,
  earlinessFactor,
  eloUpdate,
  washNotional,
} from '@rook/engine';
import type { EngineConfig, RatingState, Trade, UserWindowPerf } from '@rook/engine';

const cfg: EngineConfig = structuredClone(defaultConfig);

const trade = (over: Partial<Trade>): Trade => ({
  assetId: 'a', actor: 'user', actorId: 'u1', side: 'buy', ts: 0,
  qty: 10, cashDelta: -100, priceBefore: 10, priceAfter: 10.02, ...over,
});

describe('wash detection', () => {
  it('flags offsetting round trips inside the wash window', () => {
    const trades = [
      trade({ side: 'buy', ts: 0, qty: 50, cashDelta: -500 }),
      trade({ side: 'sell', ts: 10, qty: 50, cashDelta: 500 }),
    ];
    const { gross, wash } = washNotional(cfg, trades);
    expect(gross).toBe(1000);
    expect(wash).toBe(1000); // net position 0 → fully wash
  });

  it('does not flag a held position', () => {
    const trades = [trade({ side: 'buy', ts: 0, qty: 50, cashDelta: -500 })];
    expect(washNotional(cfg, trades).wash).toBe(0);
  });

  it('does not flag a round trip far outside the wash window', () => {
    const trades = [
      trade({ side: 'buy', ts: 0, qty: 50, cashDelta: -500 }),
      trade({ side: 'sell', ts: cfg.score.washWindow * 10, qty: 50, cashDelta: 500 }),
    ];
    expect(washNotional(cfg, trades).wash).toBe(0);
  });
});

describe('earliness', () => {
  // price path: flat at 10 until t=100, ramps to 12 by t=148, flat after
  const priceAt = (_: string, ts: number): number => {
    if (ts <= 100) return 10;
    if (ts >= 148) return 12;
    return 10 + (2 * (ts - 100)) / 48;
  };

  it('rewards buying before the move over chasing it', () => {
    const early = earlinessFactor(cfg, [trade({ ts: 100, cashDelta: -500 })], priceAt);
    const chaser = earlinessFactor(cfg, [trade({ ts: 140, cashDelta: -500 })], priceAt);
    expect(early).toBeGreaterThan(chaser);
    expect(early).toBeGreaterThan(1);
  });

  it('is neutral (1) with no trades', () => {
    expect(earlinessFactor(cfg, [], priceAt)).toBe(1);
  });
});

describe('window perf + elo', () => {
  const flatIndex = Array.from({ length: 100 }, () => 100);

  const market = {
    indexValues: flatIndex,
    priceAt: () => 10,
    windowStart: 0,
    windowEnd: 100,
  };

  it('positive excess return beats the index; concentration is penalized', () => {
    const rising = Array.from({ length: 100 }, (_, i) => 10_000 + i * 10);
    const base = {
      portfolioValues: rising,
      trades: [trade({ cashDelta: -600 })],
    };
    const diversified = computeWindowPerf(cfg, {
      userId: 'd', ...base, avgWeights: { a: 0.2, b: 0.2, c: 0.2 },
    }, market);
    const concentrated = computeWindowPerf(cfg, {
      userId: 'c', ...base, avgWeights: { a: 0.95 },
    }, market);
    expect(diversified.signal).toBeGreaterThan(0);
    expect(concentrated.signal).toBeLessThan(diversified.signal);
  });

  it('wash volume earns no volume credit', () => {
    const flat = Array.from({ length: 100 }, () => 10_000);
    const washer = computeWindowPerf(cfg, {
      userId: 'w',
      portfolioValues: flat,
      trades: [
        trade({ side: 'buy', ts: 0, qty: 100, cashDelta: -1000 }),
        trade({ side: 'sell', ts: 5, qty: 100, cashDelta: 1000 }),
      ],
      avgWeights: {},
    }, market);
    expect(washer.washFraction).toBe(1);
    expect(washer.volumeWeight).toBe(0);
    // wash volume is actively penalized, not merely uncredited
    expect(washer.signal).toBeLessThan(0);
  });

  it('elo moves winners up, losers down, provisional users faster', () => {
    const ratings = new Map<string, RatingState>();
    const perf = (userId: string, signal: number): UserWindowPerf => ({
      userId, ret: 0, excess: 0, vol: 0, riskAdjusted: 0,
      earliness: 1, washFraction: 0, volumeWeight: 1, hhi: 0, signal,
    });
    eloUpdate(cfg, ratings, [perf('a', 1), perf('b', -1), perf('c', 0)]);
    expect(ratings.get('a')!.rating).toBeGreaterThan(cfg.score.initialRating);
    expect(ratings.get('b')!.rating).toBeLessThan(cfg.score.initialRating);
    const firstMove = ratings.get('a')!.rating - cfg.score.initialRating;
    // after provisional windows, the same result moves the rating less
    for (let i = 0; i < cfg.score.provisionalWindows; i++) {
      eloUpdate(cfg, ratings, [perf('a', 0), perf('b', 0), perf('c', 0)]);
    }
    const before = ratings.get('a')!.rating;
    eloUpdate(cfg, ratings, [perf('a', 1), perf('b', -1), perf('c', 0)]);
    const laterMove = ratings.get('a')!.rating - before;
    expect(Math.abs(laterMove)).toBeLessThan(Math.abs(firstMove));
  });
});
