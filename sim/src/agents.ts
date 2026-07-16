import { Rng } from './rng.js';
import type { Market } from './market.js';
import type { SimEvent } from './news.js';

export type Archetype =
  | 'early' // diversified, reacts to news before the crowd — should rank top
  | 'momentum' // chases 24h price moves — should rank mid
  | 'concentrator' // all-in on one asset, churns — should rank below momentum
  | 'wash' // farms volume with round trips — should rank ~bottom
  | 'casual'; // background noise: delayed news reaction + random trades

export interface Agent {
  id: string;
  archetype: Archetype;
  rng: Rng;
  /** early only: probability of acting on an event (skill) */
  acuity?: number;
  /** concentrator only: the one asset they believe in */
  favorite?: string;
  /** casual only: how far behind the news they run, in ticks */
  lag?: number;
}

export function makeAgents(rng: Rng, assetIds: string[], counts: Record<Archetype, number>): Agent[] {
  const agents: Agent[] = [];
  let n = 0;
  const add = (archetype: Archetype, extra: Partial<Agent> = {}) => {
    agents.push({ id: `${archetype}-${n++}`, archetype, rng: new Rng(rng.int(1, 2 ** 31)), ...extra });
  };
  for (let i = 0; i < counts.early; i++) add('early', { acuity: i < counts.early / 2 ? 0.95 : 0.6 });
  for (let i = 0; i < counts.momentum; i++) add('momentum');
  for (let i = 0; i < counts.concentrator; i++) add('concentrator', { favorite: rng.pick(assetIds) });
  for (let i = 0; i < counts.wash; i++) add('wash');
  for (let i = 0; i < counts.casual; i++) add('casual', { lag: rng.int(2, 48) });
  return agents;
}

/** Recent events an agent may react to, provided by the runner each tick. */
export interface TickContext {
  ts: number;
  /** events that fired exactly this tick */
  fresh: SimEvent[];
  /** events within the last 48 ticks (crowd reaction window) */
  recent: SimEvent[];
  /** 24h return per asset */
  ret24: Map<string, number>;
  assetIds: string[];
}

/** Target deployed fraction after the starter flow (§23.1: first session ends with a portfolio). */
const STARTER_TARGET: Record<Archetype, number> = {
  early: 0.6,
  momentum: 0.45,
  concentrator: 0.85,
  wash: 0, // pure wash behavior: no real book, only round trips
  casual: 0.55,
};

/** Week-1 starter flow; returns true while the agent is still deploying. */
function starterFlow(agent: Agent, market: Market, ctx: TickContext): boolean {
  if (ctx.ts >= 96) return false;
  const pv = market.portfolioValue(agent.id);
  const cash = market.cash.get(agent.id) ?? 0;
  const deployed = pv > 0 ? 1 - cash / pv : 0;
  if (deployed >= STARTER_TARGET[agent.archetype]) return false;
  if (agent.rng.chance(0.25)) {
    const asset =
      agent.archetype === 'concentrator' ? agent.favorite! : agent.rng.pick(ctx.assetIds);
    market.tryUserTrade(agent.id, asset, 'buy', agent.rng.range(300, 800), ctx.ts);
  }
  return true;
}

export function agentTick(agent: Agent, market: Market, ctx: TickContext): void {
  const { rng } = agent;
  if (starterFlow(agent, market, ctx)) return;
  switch (agent.archetype) {
    case 'early': {
      // React immediately to fresh medium/large events, diversified sizing.
      for (const e of ctx.fresh) {
        if (e.magnitude === 'small' || !rng.chance(agent.acuity ?? 0.5)) continue;
        const notional = rng.range(500, 950) * e.crowdWeight;
        if (e.sign > 0) {
          // position cap: keep any single asset under ~25% of portfolio
          const pv = market.portfolioValue(agent.id);
          const held = market.holding(agent.id, e.assetId) * market.price(e.assetId);
          if (held < 0.25 * pv) market.tryUserTrade(agent.id, e.assetId, 'buy', notional, ctx.ts);
        } else {
          market.tryUserTrade(agent.id, e.assetId, 'sell', notional, ctx.ts);
        }
      }
      // occasional rebalance into a starter portfolio early in the season
      if (ctx.ts < 7 * 24 && rng.chance(0.05)) {
        market.tryUserTrade(agent.id, rng.pick(ctx.assetIds), 'buy', rng.range(200, 500), ctx.ts);
      }
      break;
    }
    case 'momentum': {
      if (!rng.chance(0.06)) break; // checks the tape ~1.5×/day
      let best: string | null = null;
      let worst: string | null = null;
      for (const a of ctx.assetIds) {
        const r = ctx.ret24.get(a) ?? 0;
        if (best === null || r > (ctx.ret24.get(best) ?? 0)) best = a;
        if (worst === null || r < (ctx.ret24.get(worst) ?? 0)) worst = a;
      }
      if (best && (ctx.ret24.get(best) ?? 0) > 0.015) {
        market.tryUserTrade(agent.id, best, 'buy', rng.range(300, 700), ctx.ts);
      }
      if (worst && (ctx.ret24.get(worst) ?? 0) < -0.015 && market.holding(agent.id, worst) > 0) {
        market.tryUserTrade(agent.id, worst, 'sell', rng.range(300, 700), ctx.ts);
      }
      break;
    }
    case 'concentrator': {
      const fav = agent.favorite!;
      // pile in until fully deployed, then churn: dump ~30% and rebuy days later
      if (rng.chance(0.03) && (market.cash.get(agent.id) ?? 0) > 500) {
        market.tryUserTrade(agent.id, fav, 'buy', rng.range(600, 1000), ctx.ts);
      } else if (rng.chance(0.006)) {
        const heldValue = market.holding(agent.id, fav) * market.price(fav);
        market.tryUserTrade(agent.id, fav, 'sell', heldValue * 0.3, ctx.ts);
      }
      break;
    }
    case 'wash': {
      // several times a day: buy then sell back the same asset within hours
      if (rng.chance(0.1)) {
        const a = rng.pick(ctx.assetIds);
        const notional = rng.range(400, 900);
        const t = market.tryUserTrade(agent.id, a, 'buy', notional, ctx.ts);
        if (t) {
          // schedule-free sim shortcut: unwind immediately-ish (same tick);
          // wash detection works on the washWindow so this is the easy case
          market.tryUserTrade(agent.id, a, 'sell', Math.abs(t.cashDelta) * 1.001, ctx.ts);
        }
      }
      break;
    }
    case 'casual': {
      // baseline ~1 action every 2 days, rising on newsy days (crowd bursts)
      const actP = 0.02 + Math.min(0.09, 0.012 * ctx.recent.length);
      if (!rng.chance(actP)) break;
      // delayed reaction to recent news the agent has "seen" (older than lag)
      const seen = ctx.recent.filter((e) => ctx.ts - e.ts >= (agent.lag ?? 12));
      if (seen.length > 0 && rng.chance(0.8)) {
        const e = rng.pick(seen);
        const notional = rng.range(150, 450) * e.crowdWeight;
        if (e.sign > 0) market.tryUserTrade(agent.id, e.assetId, 'buy', notional, ctx.ts);
        else market.tryUserTrade(agent.id, e.assetId, 'sell', notional, ctx.ts);
      } else if (rng.chance(0.6)) {
        market.tryUserTrade(agent.id, rng.pick(ctx.assetIds), 'buy', rng.range(100, 300), ctx.ts);
      } else {
        // take profit on something held
        const held = [...(market.holdings.get(agent.id) ?? new Map())].filter(([, q]) => q > 0);
        if (held.length > 0) {
          const [a] = held[agent.rng.int(0, held.length)]!;
          market.tryUserTrade(agent.id, a, 'sell', rng.range(100, 300), ctx.ts);
        }
      }
      break;
    }
  }
}
