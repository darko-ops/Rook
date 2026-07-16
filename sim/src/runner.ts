import { computeWindowPerf, eloUpdate } from '@rook/engine';
import type { EngineConfig, RatingState, Trade, UserWindowPerf } from '@rook/engine';
import { agentTick, makeAgents, type Agent, type Archetype } from './agents.js';
import { Market } from './market.js';
import { generateSeason, TICKS_PER_DAY, type SimEvent } from './news.js';
import { Rng } from './rng.js';

export interface RunOptions {
  seed: number;
  seasonDays: number;
  counts: Record<Archetype, number>;
  /** optional whale stress: an extra agent hammering one asset mid-season */
  whale?: boolean;
}

export interface DayStats {
  day: number;
  newsDay: boolean; // ≥1 medium/large event
  perAsset: Array<{
    assetId: string;
    ret: number;
    organicImpact: number;
    houseImpact: number;
    houseShare: number; // houseImpact / (houseImpact + organicImpact)
    organicNotional: number;
  }>;
  medianAgentAbsMove: number;
}

export interface RunResult {
  cfg: EngineConfig;
  opts: RunOptions;
  days: DayStats[];
  ratings: Map<string, RatingState>;
  agents: Agent[];
  finalPrices: Map<string, number>;
  moverSkips: Record<string, number>;
  whaleMaxTickMove: number;
  perfHistory: Map<string, UserWindowPerf[]>;
}

export const ASSET_IDS = ['RBR', 'FER', 'MER', 'MCL', 'AST', 'ALP', 'WIL', 'VRB', 'SAU', 'HAA'];

export function runSeason(cfg: EngineConfig, opts: RunOptions): RunResult {
  const rng = new Rng(opts.seed);
  const agents = makeAgents(rng, ASSET_IDS, opts.counts);
  const agentIds = agents.map((a) => a.id);
  if (opts.whale) agentIds.push('whale-0');
  const market = new Market(cfg, ASSET_IDS, agentIds);
  const events = generateSeason(rng, ASSET_IDS, opts.seasonDays);
  const totalTicks = opts.seasonDays * TICKS_PER_DAY;

  // price history per asset per tick (for ret24, earliness lookups, charts)
  const priceHist = new Map<string, number[]>(ASSET_IDS.map((a) => [a, []]));
  const indexHist: number[] = [];
  const pvHist = new Map<string, number[]>(agentIds.map((id) => [id, []]));

  const byTick = new Map<number, SimEvent[]>();
  for (const e of events) {
    (byTick.get(e.ts) ?? byTick.set(e.ts, []).get(e.ts)!).push(e);
  }

  const ratings = new Map<string, RatingState>();
  const perfHistory = new Map<string, UserWindowPerf[]>();
  const moverSkips: Record<string, number> = {};
  let windowStart = 0;
  let whaleMaxTickMove = 0;

  const priceAt = (assetId: string, ts: number): number => {
    const h = priceHist.get(assetId)!;
    const i = Math.max(0, Math.min(h.length - 1, Math.floor(ts)));
    return h[i] ?? cfg.curve.p0;
  };

  const whaleRng = new Rng(opts.seed ^ 0x5eed);
  const whaleAsset = ASSET_IDS[0]!;
  const whaleStart = Math.floor(totalTicks / 2);

  for (let ts = 0; ts < totalTicks; ts++) {
    // record prices first so ret24/earliness see start-of-tick state
    for (const a of ASSET_IDS) priceHist.get(a)!.push(market.price(a));
    const cap = market.marketCap();
    indexHist.push(cap > 0 ? cap : 1);

    const fresh = byTick.get(ts) ?? [];
    const recent: SimEvent[] = [];
    for (let t = Math.max(0, ts - 48); t <= ts; t++) {
      for (const e of byTick.get(t) ?? []) recent.push(e);
    }
    const ret24 = new Map<string, number>();
    for (const a of ASSET_IDS) {
      const h = priceHist.get(a)!;
      const then = h[Math.max(0, h.length - 1 - 24)]!;
      ret24.set(a, then > 0 ? h[h.length - 1]! / then - 1 : 0);
    }

    // house mover consumes fresh classified events
    for (const e of fresh) {
      const decision = market.mover.decide(e, market.assets.get(e.assetId)!);
      if (decision.execute) {
        market.houseTrade(e.assetId, e.sign > 0 ? 'buy' : 'sell', decision.qty, ts);
      } else {
        moverSkips[decision.reason] = (moverSkips[decision.reason] ?? 0) + 1;
      }
    }

    // agents act in a shuffled-ish but deterministic order
    const ctx = { ts, fresh, recent, ret24, assetIds: ASSET_IDS };
    const offset = ts % agents.length;
    for (let i = 0; i < agents.length; i++) {
      agentTick(agents[(i + offset) % agents.length]!, market, ctx);
    }

    // whale stress: mid-season, hammer one asset with max-cap buys for 3h
    if (opts.whale && ts >= whaleStart && ts < whaleStart + 3) {
      const before = market.price(whaleAsset);
      for (let i = 0; i < 4; i++) {
        market.tryUserTrade('whale-0', whaleAsset, 'buy', cfg.trading.maxTradeNotional, ts);
      }
      const move = Math.abs(market.price(whaleAsset) / before - 1);
      whaleMaxTickMove = Math.max(whaleMaxTickMove, move);
      void whaleRng;
    }

    for (const id of agentIds) pvHist.get(id)!.push(market.portfolioValue(id));

    // scoring window rollover
    if ((ts + 1) % cfg.score.windowTicks === 0 || ts === totalTicks - 1) {
      const windowEnd = ts + 1;
      const windowTrades = market.trades.filter((t) => t.ts >= windowStart && t.ts < windowEnd);
      const assetGross = new Map<string, number>();
      for (const t of windowTrades) {
        assetGross.set(t.assetId, (assetGross.get(t.assetId) ?? 0) + Math.abs(t.cashDelta));
      }
      const perfs = agentIds
        .filter((id) => !id.startsWith('whale'))
        .map((id) => {
          const trades = windowTrades.filter((t) => t.actorId === id);
          const avgWeights: Record<string, number> = {};
          const pv = pvHist.get(id)!;
          const samples: number[] = [];
          for (let d = windowStart; d < windowEnd; d += TICKS_PER_DAY) samples.push(d);
          for (const a of ASSET_IDS) {
            let w = 0;
            for (const s of samples) {
              const v = pv[s] ?? 1;
              w += (market.holding(id, a) * priceAt(a, s)) / Math.max(v, 1);
            }
            avgWeights[a] = w / samples.length;
          }
          // anti-pump input: user's share of their top asset's window volume
          let topAsset: string | null = null;
          for (const a of ASSET_IDS) {
            if (topAsset === null || (avgWeights[a] ?? 0) > (avgWeights[topAsset] ?? 0)) topAsset = a;
          }
          let dominantFlowShare = 0;
          if (topAsset && (avgWeights[topAsset] ?? 0) > 0.05) {
            const own = trades
              .filter((t) => t.assetId === topAsset)
              .reduce((s, t) => s + Math.abs(t.cashDelta), 0);
            const total = assetGross.get(topAsset) ?? 0;
            dominantFlowShare = total > 0 ? own / total : 0;
          }
          return computeWindowPerf(
            cfg,
            {
              userId: id,
              portfolioValues: pv.slice(windowStart, windowEnd),
              trades,
              avgWeights,
              dominantFlowShare,
            },
            {
              indexValues: indexHist.slice(windowStart, windowEnd),
              priceAt,
              windowStart,
              windowEnd,
            },
          );
        });
      eloUpdate(cfg, ratings, perfs);
      for (const p of perfs) {
        (perfHistory.get(p.userId) ?? perfHistory.set(p.userId, []).get(p.userId)!).push(p);
      }
      windowStart = windowEnd;
    }
  }

  // daily stats
  const days: DayStats[] = [];
  const impactByDay = new Map<string, { organic: number; house: number; organicNotional: number }>();
  for (const t of market.trades) {
    const day = Math.floor(t.ts / TICKS_PER_DAY);
    const key = `${day}:${t.assetId}`;
    const rec = impactByDay.get(key) ?? { organic: 0, house: 0, organicNotional: 0 };
    const impact = Math.abs(t.priceAfter - t.priceBefore);
    if (t.actor === 'house') rec.house += impact;
    else {
      rec.organic += impact;
      rec.organicNotional += Math.abs(t.cashDelta);
    }
    impactByDay.set(key, rec);
  }
  for (let day = 0; day < opts.seasonDays; day++) {
    const start = day * TICKS_PER_DAY;
    const end = Math.min(totalTicks - 1, start + TICKS_PER_DAY);
    const newsDay = events.some(
      (e) => e.ts >= start && e.ts < end && e.magnitude !== 'small',
    );
    const perAsset = ASSET_IDS.map((assetId) => {
      const h = priceHist.get(assetId)!;
      const open = h[start] ?? cfg.curve.p0;
      const close = h[end] ?? open;
      const rec = impactByDay.get(`${day}:${assetId}`) ?? { organic: 0, house: 0, organicNotional: 0 };
      const denom = rec.organic + rec.house;
      return {
        assetId,
        ret: open > 0 ? close / open - 1 : 0,
        organicImpact: rec.organic,
        houseImpact: rec.house,
        houseShare: denom > 0 ? rec.house / denom : 0,
        organicNotional: rec.organicNotional,
      };
    });
    const moves = agentIds
      .filter((id) => !id.startsWith('whale'))
      .map((id) => {
        const pv = pvHist.get(id)!;
        const a = pv[start] ?? 1;
        const b = pv[end] ?? a;
        return a > 0 ? Math.abs(b / a - 1) : 0;
      })
      .sort((x, y) => x - y);
    days.push({
      day,
      newsDay,
      perAsset,
      medianAgentAbsMove: moves[Math.floor(moves.length / 2)] ?? 0,
    });
  }

  return {
    cfg,
    opts,
    days,
    ratings,
    agents,
    finalPrices: new Map(ASSET_IDS.map((a) => [a, market.price(a)])),
    moverSkips,
    whaleMaxTickMove,
    perfHistory,
  };
}
