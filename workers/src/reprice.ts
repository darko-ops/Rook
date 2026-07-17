import { closeDb, db, migrate } from '@rook/db';
import {
  currentSeason,
  executeUserTrade,
  loadConfig,
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
  position: number | null;
}

async function loadAssets(seasonId: number): Promise<AssetView[]> {
  const rows = await db()`
    select a.id, a.symbol, a.name, a.kind, a.p0 + a.m * a.supply as price,
           s.points, s.position
    from assets a
    left join standings s on s.asset_id = a.id and s.season_id = a.season_id
    where a.season_id = ${seasonId}
  `;
  return rows.map((r) => ({
    id: r.id, symbol: r.symbol, name: r.name, kind: r.kind, price: r.price,
    points: r.points, position: r.position,
  }));
}

/**
 * Agents' value heuristic under standings-anchored settlement (decision H):
 * fair value = expected payout at the current championship position, blended
 * toward the mean payout by how *settled* that position is. Two forces make
 * a position settled: season depth (time burns off uncertainty for everyone)
 * and points cushion (a dominant leader is settled long before the calendar
 * says so — mid-season standings gaps carry information the pure time blend
 * threw away, which kept leaders structurally underpriced).
 *
 *   wTime = sqrt(progress)
 *   lock  = gap to nearest rival / realistic catch-up (½ the best per-round
 *           rate sustained over the remaining rounds), clamped to [0, 1]
 *   w     = wTime + (1 − wTime) · lock          // cushion accelerates time
 *   fair  = w · payout + (1 − w) · mean payout
 *
 * A mathematically locked position (gap no rival can close) prices at full
 * payout regardless of date. signal = (fair − price) / fair; > 0 → underpriced.
 */
function valueSignals(
  assets: Array<AssetView & { position: number | null }>,
  payouts: { team: number[]; driver: number[] },
  rounds: { done: number; total: number },
): Map<number, number> {
  const progress = Math.min(1, Math.max(0, rounds.done / rounds.total));
  const wTime = Math.sqrt(progress);
  const roundsLeft = Math.max(0, rounds.total - rounds.done);
  const out = new Map<number, number>();
  for (const kind of ['team', 'driver'] as const) {
    const group = assets
      .filter((a) => a.kind === kind && a.position !== null && a.points !== null)
      .sort((x, y) => x.position! - y.position!);
    if (group.length === 0) continue;
    const table = kind === 'driver' ? payouts.driver : payouts.team;
    const mean = table.reduce((s, x) => s + x, 0) / table.length;
    const bestRate = rounds.done > 0 ? Math.max(...group.map((a) => a.points! / rounds.done)) : 0;
    const catchUp = 0.5 * bestRate * roundsLeft; // what a rival can realistically claw back
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      const neighborGaps = [
        i > 0 ? a.points! - group[i - 1]!.points! : undefined,
        i < group.length - 1 ? a.points! - group[i + 1]!.points! : undefined,
      ].filter((g): g is number => g !== undefined).map(Math.abs);
      const gap = neighborGaps.length ? Math.min(...neighborGaps) : 0;
      const lock = catchUp > 0 ? Math.min(1, gap / catchUp) : 1;
      const w = wTime + (1 - wTime) * lock;
      const payout = table[Math.min(a.position!, table.length) - 1]!;
      const fair = w * payout + (1 - w) * mean;
      out.set(a.id, (fair - a.price) / fair);
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
    where u.handle ~ '^(early|momentum|casual|concentrator|latewave)_'
  `;
  if (agents.length === 0) throw new Error('no dogfood agents in this season');

  const cfg = await loadConfig(now0);
  const payouts = { team: cfg.settlement.teamPayouts, driver: cfg.settlement.driverPayouts };
  const [{ done_rounds }] = (await sql`
    select coalesce(max(round), 0)::int as done_rounds from standings where season_id = ${season.id}
  `) as unknown as [{ done_rounds: number }];
  const [{ total_rounds }] = (await sql`
    select greatest(count(*), 1)::int as total_rounds from races where season_id = ${season.id}
  `) as unknown as [{ total_rounds: number }];
  const progress = Math.min(1, done_rounds / total_rounds);

  const before = await loadAssets(season.id);
  console.log(`repricing session: ${agents.length} agents, ${before.length} assets`);
  console.log(`settlement: ${cfg.settlement.mode} · season progress ${(100 * progress).toFixed(0)}% (${done_rounds}/${total_rounds} rounds)`);
  console.log(`before — teams ρ(price,points) = ${spearman(before, 'team').toFixed(2)}, drivers ρ = ${spearman(before, 'driver').toFixed(2)}\n`);

  const rng = new Rng(777);
  const actP: Record<string, number> = { early: 0.9, momentum: 0.5, casual: 0.4, concentrator: 0.3, latewave: 0.9 };
  const size: Record<string, [number, number]> = {
    early: [400, 900], momentum: [250, 600], casual: [100, 400], concentrator: [200, 500],
    latewave: [400, 900],
  };

  let round = 0;
  let trades = 0;
  let stallRounds = 0;
  let endState: 'converged' | 'throttled' | 'stalled' | 'max-rounds' = 'max-rounds';
  const rejects = new Map<string, number>();
  const bump = (code: string) => rejects.set(code, (rejects.get(code) ?? 0) + 1);
  for (; round < MAX_ROUNDS; round++) {
    const assets = await loadAssets(season.id);
    // converged when nothing trades ≥5% away from payout-anchored fair value
    const g = valueSignals(assets, payouts, { done: done_rounds, total: total_rounds });
    const buys = assets.filter((a) => (g.get(a.id) ?? 0) >= 0.05);
    const sells = assets.filter((a) => (g.get(a.id) ?? 0) <= -0.05);
    if (buys.length === 0 && sells.length === 0) {
      endState = 'converged';
      break;
    }
    const tradesAtRoundStart = trades;

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
            bump(e.code);
          }
        }
      }
      if (buys.length > 0) {
        // weight toward the biggest gaps, spread across the top six
        const sorted = [...buys].sort((x, y) => (g.get(y.id) ?? 0) - (g.get(x.id) ?? 0));
        const pick = sorted[Math.min(rng.int(0, 6), sorted.length - 1)]!;
        const notional = rng.range(lo, hi);
        try {
          await executeUserTrade(agent.id, { assetId: pick.id, side: 'buy', notional, now });
          trades++;
        } catch (e) {
          if (!(e instanceof TradeRejected)) throw e;
          if (e.code === 'insufficient-cash') {
            // rotation: fund conviction by selling whatever they hold that
            // isn't itself underpriced — worst signal (most overpriced) first
            const held = await sql`
              select h.asset_id, h.qty, a.p0 + a.m * a.supply as price
              from holdings h join assets a on a.id = h.asset_id
              where h.user_id = ${agent.id} and a.season_id = ${season.id} and h.qty > 1
            `;
            const nearFair = held
              .filter((x) => (g.get(x.asset_id) ?? 0) < 0.049 && x.asset_id !== pick.id)
              .sort((x, y) => (g.get(x.asset_id) ?? 0) - (g.get(y.asset_id) ?? 0))[0];
            if (nearFair) {
              try {
                await executeUserTrade(agent.id, {
                  assetId: nearFair.asset_id,
                  side: 'sell',
                  qty: Math.min(nearFair.qty, notional / nearFair.price),
                  now,
                });
                await executeUserTrade(agent.id, { assetId: pick.id, side: 'buy', notional, now });
                trades += 2;
              } catch (e2) {
                if (!(e2 instanceof TradeRejected)) throw e2;
                bump(e2.code);
              }
            } else {
              bump(e.code); // out of cash with nothing rotatable
            }
          } else {
            bump(e.code);
          }
        }
      }
    }

    // stall detection: agents still see gaps but nothing can execute —
    // without this the session spins silently and reads as "didn't budge"
    stallRounds = trades === tradesAtRoundStart ? stallRounds + 1 : 0;
    if (stallRounds >= 5) {
      const rateLimited = rejects.get('rate-limit') ?? 0;
      const total = [...rejects.values()].reduce((s, x) => s + x, 0);
      endState = total > 0 && rateLimited >= total / 2 ? 'throttled' : 'stalled';
      break;
    }
  }

  const endNow = new Date(now0.getTime() + (round + 1) * 36e3);
  await snapshotPrices(endNow);
  const after = await loadAssets(season.id);

  console.log(`done after ${round} rounds · ${trades} trades · market time ≈ ${((round * 36) / 60).toFixed(0)} min`);
  if (rejects.size > 0) {
    console.log(`rejections — ${[...rejects.entries()].map(([c, n]) => `${c}: ${n}`).join(' · ')}`);
  }
  if (endState === 'converged') {
    console.log('converged: nothing trades ≥5% from payout-anchored fair\n');
  } else if (endState === 'throttled') {
    console.log(
      `STALLED ON RATE LIMITS: per-asset daily trade windows are exhausted ` +
        `(trading.maxTradesPerAssetPerDay = ${cfg.trading.maxTradesPerAssetPerDay}, rolling 24h). ` +
        `Prices did NOT converge this session. Re-run after the window rolls, ` +
        `or raise the limit via setConfig for a compressed session and restore it after.\n`,
    );
  } else if (endState === 'stalled') {
    console.log('STALLED: agents see gaps but cannot execute (see rejections) — market did not converge.\n');
  } else {
    console.log('hit MAX_ROUNDS before convergence.\n');
  }
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
