import type { Archetype } from './agents.js';
import type { RunResult } from './runner.js';

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i]!;
}

export interface Evaluation {
  // Exit criterion 1 — liveliness band
  medianAbsDailyRet: number; // across asset-days
  p95AbsDailyRet: number;
  maxAbsDailyRet: number;
  flatline: boolean; // median < 0.3%
  whipsaw: boolean; // p95 > 12% or max > 25%
  // Exit criterion 2 — mover behavior
  newsDayMedianAgentMove: number; // median agent |portfolio move| on news days
  quietDayMedianAgentMove: number;
  newsDaysVisible: boolean; // ≥ 0.4% median portfolio move on news days
  houseShareP95: number; // over asset-days with organic activity
  houseShareMax: number;
  houseUnderCap: boolean;
  houseShareLowOrganic: number; // mean share when organic notional < V*/4
  houseShareHighOrganic: number; // mean share when organic notional ≥ V*
  decayWorks: boolean;
  // Exit criterion 3 — Rook Score ordering
  meanRatingByArchetype: Record<Archetype, number>;
  orderingOk: boolean;
  washNearBottom: boolean;
  // stress
  whaleMaxTickMove: number;
}

export function evaluate(run: RunResult): Evaluation {
  const cfg = run.cfg;
  const absRets: number[] = [];
  const newsMoves: number[] = [];
  const quietMoves: number[] = [];
  const sharesActive: number[] = [];
  const sharesLow: number[] = [];
  const sharesHigh: number[] = [];

  // Days 0–4 are the starter flow / price-discovery window: every stack
  // deploying from an identical flat start is expected repricing, not
  // steady-state behavior, so band metrics start at day 5.
  for (const d of run.days) {
    if (d.day < 5) continue;
    for (const a of d.perAsset) {
      absRets.push(Math.abs(a.ret));
      if (a.organicImpact + a.houseImpact > 0 && a.organicNotional > 0) {
        sharesActive.push(a.houseShare);
      }
      if (a.organicNotional < cfg.mover.vStar / 4) sharesLow.push(a.houseShare);
      else if (a.organicNotional >= cfg.mover.vStar) sharesHigh.push(a.houseShare);
    }
    (d.newsDay ? newsMoves : quietMoves).push(d.medianAgentAbsMove);
  }

  const medianAbsDailyRet = quantile(absRets, 0.5);
  const p95AbsDailyRet = quantile(absRets, 0.95);
  const maxAbsDailyRet = quantile(absRets, 1);
  const newsDayMedianAgentMove = quantile(newsMoves, 0.5);
  const quietDayMedianAgentMove = quantile(quietMoves, 0.5);
  const houseShareP95 = quantile(sharesActive, 0.95);
  const houseShareMax = quantile(sharesActive, 1);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const houseShareLowOrganic = mean(sharesLow);
  const houseShareHighOrganic = mean(sharesHigh);

  const byArch = new Map<Archetype, number[]>();
  for (const agent of run.agents) {
    const r = run.ratings.get(agent.id);
    if (!r) continue;
    (byArch.get(agent.archetype) ?? byArch.set(agent.archetype, []).get(agent.archetype)!).push(r.rating);
  }
  const meanRatingByArchetype = Object.fromEntries(
    [...byArch.entries()].map(([k, v]) => [k, mean(v)]),
  ) as Record<Archetype, number>;

  const { early, momentum, concentrator, wash, casual } = meanRatingByArchetype;
  const orderingOk = early > momentum && momentum > concentrator;
  const washNearBottom = wash <= Math.min(momentum, casual, early) && wash < concentrator + 50;

  return {
    medianAbsDailyRet,
    p95AbsDailyRet,
    maxAbsDailyRet,
    flatline: medianAbsDailyRet < 0.003,
    whipsaw: p95AbsDailyRet > 0.12 || maxAbsDailyRet > 0.25,
    newsDayMedianAgentMove,
    quietDayMedianAgentMove,
    newsDaysVisible: newsDayMedianAgentMove >= 0.004,
    houseShareP95,
    houseShareMax,
    houseUnderCap: houseShareP95 <= cfg.mover.capC + 0.02,
    houseShareLowOrganic,
    houseShareHighOrganic,
    decayWorks: houseShareHighOrganic < houseShareLowOrganic * 0.35 || houseShareHighOrganic < 0.05,
    meanRatingByArchetype,
    orderingOk,
    washNearBottom,
    whaleMaxTickMove: run.whaleMaxTickMove,
  };
}
