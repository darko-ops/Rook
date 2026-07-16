import { closeDb, db, migrate } from '@rook/db';
import {
  currentSeason,
  executeUserTrade,
  Rng,
  snapshotPrices,
  syncStandings,
  TradeRejected,
} from '@rook/core';

/**
 * Repricing session: the dogfood agents, now standings-aware. Each agent
 * compares an asset's rank-by-price with its rank-by-championship-points
 * (within its asset class) and trades the gap — buying underpriced,
 * selling overpriced from holdings. Every trade goes through the real
 * trade path; Rook itself moves nothing.
 *
 * This is exactly the convergence story from the market screen: standings
 * are the sport, prices are the market, the gap is the edge.
 */

const MAX_ROUNDS = 400;
const TARGET_CORRELATION = 0.85;

interface AssetView {
  id: number;
  symbol: string;
  name: string;
  kind: 'team' | 'driver';
  price: number;
  points: number | null;
}

async function loadAssets(seasonId: number): Promise<AssetView[]> {
  const rows = await db()`
    select a.id, a.symbol, a.name, a.kind, a.p0 + a.m * a.supply as price, s.points
    from assets a
    left join standings s on s.asset_id = a.id and s.season_id = a.season_id
    where a.season_id = ${seasonId}
  `;
  return rows.map((r) => ({
    id: r.id, symbol: r.symbol, name: r.name, kind: r.kind, price: r.price, points: r.points,
  }));
}

/**
 * Agents' value heuristic, share-based so a flat start still trades:
 * signal = share of the class's championship points − share of the class's
 * price premium over p0. Positive → underpriced, negative → overpriced.
 */
function valueSignals(assets: AssetView[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const kind of ['team', 'driver'] as const) {
    const group = assets.filter((a) => a.kind === kind && a.points !== null);
    if (group.length === 0) continue;
    const totalPoints = group.reduce((s, a) => s + a.points!, 0) || 1;
    const premiums = group.map((a) => Math.max(0, a.price - 10));
    const totalPrem = premiums.reduce((s, p) => s + p, 0);
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      const pointsShare = a.points! / totalPoints;
      const premShare = totalPrem > 1e-9 ? premiums[i]! / totalPrem : 1 / group.length;
      out.set(a.id, pointsShare - premShare);
    }
  }
  return out;
}

/** tie-aware average ranks so a flat start reads as unordered, not perfect */
function ranks(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as const).sort((x, y) => y[0] - x[0]);
  const out = new Array<number>(vals.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j < idx.length && idx[j]![0] === idx[i]![0]) j++;
    const avg = (i + j - 1) / 2;
    for (let k = i; k < j; k++) out[idx[k]![1]] = avg;
    i = j;
  }
  return out;
}

function spearman(assets: AssetView[], kind: 'team' | 'driver'): number {
  const group = assets.filter((a) => a.kind === kind && a.points !== null);
  if (group.length < 3) return 1;
  const pr = ranks(group.map((a) => a.points!));
  const qr = ranks(group.map((a) => a.price));
  const meanP = pr.reduce((s, x) => s + x, 0) / pr.length;
  const meanQ = qr.reduce((s, x) => s + x, 0) / qr.length;
  let cov = 0;
  let vp = 0;
  let vq = 0;
  for (let i = 0; i < pr.length; i++) {
    cov += (pr[i]! - meanP) * (qr[i]! - meanQ);
    vp += (pr[i]! - meanP) ** 2;
    vq += (qr[i]! - meanQ) ** 2;
  }
  return vp > 0 && vq > 0 ? cov / Math.sqrt(vp * vq) : 0;
}

async function main() {
  await migrate();
  const sql = db();
  const now0 = new Date();
  const season = await currentSeason(now0);
  if (!season) throw new Error('no open season');
  await syncStandings(season.id, now0);

  const agents = await sql`
    select u.id, u.handle from users u
    join balances b on b.user_id = u.id and b.season_id = ${season.id}
    where u.handle ~ '^(early|momentum|casual|concentrator)_'
  `;
  if (agents.length === 0) throw new Error('no dogfood agents in this season');

  const before = await loadAssets(season.id);
  console.log(`repricing session: ${agents.length} agents, ${before.length} assets`);
  console.log(`before — teams ρ(price,points) = ${spearman(before, 'team').toFixed(2)}, drivers ρ = ${spearman(before, 'driver').toFixed(2)}\n`);

  const rng = new Rng(777);
  const actP: Record<string, number> = { early: 0.9, momentum: 0.5, casual: 0.4, concentrator: 0.3 };
  const size: Record<string, [number, number]> = {
    early: [400, 900], momentum: [250, 600], casual: [100, 400], concentrator: [200, 500],
  };

  let round = 0;
  let trades = 0;
  for (; round < MAX_ROUNDS; round++) {
    const assets = await loadAssets(season.id);
    if (
      spearman(assets, 'team') >= TARGET_CORRELATION &&
      spearman(assets, 'driver') >= TARGET_CORRELATION
    ) break;
    const g = valueSignals(assets);
    const buys = assets.filter((a) => (g.get(a.id) ?? 0) >= 0.02);
    const sells = assets.filter((a) => (g.get(a.id) ?? 0) <= -0.02);
    if (buys.length === 0 && sells.length === 0) break;

    const now = new Date(now0.getTime() + round * 36e3); // ~36s per round
    for (const agent of agents) {
      const arch = (agent.handle as string).split('_')[0]!;
      if (!rng.chance(actP[arch] ?? 0.3)) continue;
      const [lo, hi] = size[arch] ?? [100, 400];

      // sell an overpriced holding first (frees cash, closes the gap)
      if (sells.length > 0 && rng.chance(0.5)) {
        const target = sells[rng.int(0, sells.length)]!;
        const [h] = await sql`
          select qty from holdings where user_id = ${agent.id} and asset_id = ${target.id} and qty > 0.5
        `;
        if (h) {
          try {
            const qty = Math.min(h.qty, rng.range(lo, hi) / target.price);
            await executeUserTrade(agent.id, { assetId: target.id, side: 'sell', qty, now });
            trades++;
          } catch (e) {
            if (!(e instanceof TradeRejected)) throw e;
          }
        }
      }
      if (buys.length > 0) {
        // weight toward the biggest gaps
        const sorted = [...buys].sort((x, y) => (g.get(y.id) ?? 0) - (g.get(x.id) ?? 0));
        const pick = sorted[Math.min(rng.int(0, 3), sorted.length - 1)]!;
        try {
          await executeUserTrade(agent.id, {
            assetId: pick.id, side: 'buy', notional: rng.range(lo, hi), now,
          });
          trades++;
        } catch (e) {
          if (!(e instanceof TradeRejected)) throw e;
        }
      }
    }
  }

  const endNow = new Date(now0.getTime() + (round + 1) * 36e3);
  await snapshotPrices(endNow);
  const after = await loadAssets(season.id);

  console.log(`done after ${round} rounds · ${trades} trades · market time ≈ ${((round * 36) / 60).toFixed(0)} min`);
  console.log(`after — teams ρ = ${spearman(after, 'team').toFixed(2)}, drivers ρ = ${spearman(after, 'driver').toFixed(2)}\n`);
  for (const kind of ['team', 'driver'] as const) {
    const group = after.filter((a) => a.kind === kind && a.points !== null)
      .sort((x, y) => y.points! - x.points!);
    if (group.length === 0) continue;
    console.log(kind === 'team' ? 'TEAMS (by championship)' : 'RACERS (by championship)');
    for (const a of group) {
      const b = before.find((x) => x.id === a.id)!;
      const chg = ((a.price / b.price - 1) * 100).toFixed(1);
      console.log(
        `  ${String(a.points).padStart(4)} pts  ${a.name.padEnd(22)} $${b.price.toFixed(2).padStart(6)} → $${a.price.toFixed(2).padStart(6)}  (${Number(chg) >= 0 ? '+' : ''}${chg}%)`,
      );
    }
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
