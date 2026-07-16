import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultConfig } from '@rook/engine';
import type { EngineConfig } from '@rook/engine';
import type { Archetype } from './agents.js';
import { evaluate, type Evaluation } from './metrics.js';
import { runSeason } from './runner.js';

const SEASON_DAYS = 140; // 20 weeks, 10 race weekends
const COUNTS: Record<Archetype, number> = {
  early: 8,
  momentum: 6,
  concentrator: 3,
  wash: 3,
  casual: 30,
};
const SEEDS = [11, 42, 1337];

type Num = number;
const pct = (x: Num) => `${(100 * x).toFixed(2)}%`;

function cloneCfg(mutate: (c: EngineConfig) => void): EngineConfig {
  const c = structuredClone(defaultConfig);
  mutate(c);
  return c;
}

interface AggRow {
  label: string;
  cfg: EngineConfig;
  evals: Evaluation[];
}

function meanOf(rows: Evaluation[], f: (e: Evaluation) => number): number {
  return rows.reduce((a, e) => a + f(e), 0) / rows.length;
}
function allOf(rows: Evaluation[], f: (e: Evaluation) => boolean): boolean {
  return rows.every(f);
}

function runConfig(label: string, cfg: EngineConfig, whale = false): AggRow {
  const evals = SEEDS.map((seed) =>
    evaluate(runSeason(cfg, { seed, seasonDays: SEASON_DAYS, counts: COUNTS, whale })),
  );
  return { label, cfg, evals };
}

const report: string[] = [];
const out = (s: string) => {
  report.push(s);
  console.log(s);
};

// ---------------------------------------------------------------- sweep 1: curve steepness
out('\n=== Sweep 1: curve steepness m (mover at defaults) ===');
out('m        med|dRet|  p95|dRet|  max|dRet|  flatline  whipsaw');
const mValues = [0.0005, 0.001, 0.002, 0.003, 0.005, 0.01];
const curveRows: AggRow[] = [];
for (const m of mValues) {
  const row = runConfig(`m=${m}`, cloneCfg((c) => (c.curve.m = m)));
  curveRows.push(row);
  out(
    `${m.toString().padEnd(8)} ${pct(meanOf(row.evals, (e) => e.medianAbsDailyRet)).padEnd(10)} ` +
      `${pct(meanOf(row.evals, (e) => e.p95AbsDailyRet)).padEnd(10)} ` +
      `${pct(meanOf(row.evals, (e) => e.maxAbsDailyRet)).padEnd(10)} ` +
      `${String(!allOf(row.evals, (e) => !e.flatline)).padEnd(9)} ` +
      `${String(!allOf(row.evals, (e) => !e.whipsaw))}`,
  );
}
const inBand = curveRows.filter((r) => allOf(r.evals, (e) => !e.flatline && !e.whipsaw));
out(`In-band m values: ${inBand.map((r) => r.label).join(', ') || 'NONE'}`);
// §13.1: "start flatter and tune up" — prefer the flatter half of the band
const chosenM =
  inBand.length > 0 ? Number(inBand[Math.floor((inBand.length - 1) / 2)]!.label.slice(2)) : 0.002;
out(`Chosen m = ${chosenM} (flatter half of band, per §13.1)`);

// ---------------------------------------------------------------- sweep 2: mover params
out('\n=== Sweep 2: mover nudge scale × cap C × V* (m fixed) ===');
out('scale  C     V*     newsMove  quietMove  shareP95  shareLo→Hi      visible  underCap  decay');
const moverRows: AggRow[] = [];
for (const scale of [0.5, 1, 2]) {
  for (const capC of [0.2, 0.3]) {
    for (const vStar of [2500, 5000, 10000]) {
      const cfg = cloneCfg((c) => {
        c.curve.m = chosenM;
        c.mover.capC = capC;
        c.mover.vStar = vStar;
        c.mover.nudgeNotional = {
          small: 150 * scale,
          medium: 400 * scale,
          large: 900 * scale,
        };
        c.mover.maxNotionalPerAssetPerWindow = 1800 * scale;
      });
      const row = runConfig(`scale=${scale},C=${capC},V*=${vStar}`, cfg);
      moverRows.push(row);
      out(
        `${String(scale).padEnd(6)} ${String(capC).padEnd(5)} ${String(vStar).padEnd(6)} ` +
          `${pct(meanOf(row.evals, (e) => e.newsDayMedianAgentMove)).padEnd(9)} ` +
          `${pct(meanOf(row.evals, (e) => e.quietDayMedianAgentMove)).padEnd(10)} ` +
          `${pct(meanOf(row.evals, (e) => e.houseShareP95)).padEnd(9)} ` +
          `${pct(meanOf(row.evals, (e) => e.houseShareLowOrganic))}→${pct(meanOf(row.evals, (e) => e.houseShareHighOrganic)).padEnd(8)} ` +
          `${String(allOf(row.evals, (e) => e.newsDaysVisible)).padEnd(8)} ` +
          `${String(allOf(row.evals, (e) => e.houseUnderCap)).padEnd(9)} ` +
          `${String(allOf(row.evals, (e) => e.decayWorks))}`,
      );
    }
  }
}
const moverOk = moverRows.filter((r) =>
  allOf(r.evals, (e) => e.newsDaysVisible && e.houseUnderCap && e.decayWorks && !e.whipsaw && !e.flatline),
);
out(`Passing mover configs: ${moverOk.length}/${moverRows.length}`);
for (const r of moverOk) out(`  ✓ ${r.label}`);
const chosenMover = moverOk[0] ?? moverRows.find((r) => r.label === 'scale=1,C=0.3,V*=5000')!;
out(`Chosen mover config: ${chosenMover.label}`);

// ---------------------------------------------------------------- sweep 3: whale stress
out('\n=== Sweep 3: whale stress at chosen config (4× max-cap trades/tick × 3 ticks) ===');
const whaleRow = runConfig('whale', chosenMover.cfg, true);
out(`Max single-tick move from whale burst: ${pct(meanOf(whaleRow.evals, (e) => e.whaleMaxTickMove))}`);
out(`Whipsaw with whale: ${!allOf(whaleRow.evals, (e) => !e.whipsaw)}`);

// ---------------------------------------------------------------- rook score ordering
out('\n=== Rook Score: archetype ordering at chosen config ===');
out('seed   early    momentum  casual   concentr  wash     ordering  washBottom');
let orderingPasses = 0;
for (const [i, e] of chosenMover.evals.entries()) {
  const m = e.meanRatingByArchetype;
  out(
    `${String(SEEDS[i]).padEnd(6)} ${m.early.toFixed(0).padEnd(8)} ${m.momentum.toFixed(0).padEnd(9)} ` +
      `${m.casual.toFixed(0).padEnd(8)} ${m.concentrator.toFixed(0).padEnd(9)} ${m.wash.toFixed(0).padEnd(8)} ` +
      `${String(e.orderingOk).padEnd(9)} ${String(e.washNearBottom)}`,
  );
  if (e.orderingOk && e.washNearBottom) orderingPasses++;
}
out(`Ordering holds in ${orderingPasses}/${SEEDS.length} seeds`);

// ---------------------------------------------------------------- verdict + artifacts
out('\n=== Exit criteria verdict ===');
const c1 = inBand.length > 0;
const c2 = moverOk.length > 0;
const c3 = orderingPasses >= 2;
out(`1. Curve steepness band exists (no flatline/whipsaw): ${c1 ? 'PASS' : 'FAIL'}`);
out(`2. Mover: visible news days + under cap + decays to 0: ${c2 ? 'PASS' : 'FAIL'}`);
out(`3. Rook Score orders archetypes correctly:            ${c3 ? 'PASS' : 'FAIL'}`);

mkdirSync('out', { recursive: true });
writeFileSync('out/report.txt', report.join('\n'));
writeFileSync(
  'out/v1-config.json',
  JSON.stringify({ note: 'Phase 0 validated tunables', config: chosenMover.cfg }, null, 2),
);
out('\nWrote sim/out/report.txt and sim/out/v1-config.json');
