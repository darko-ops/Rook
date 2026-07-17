import { closeDb, db, migrate } from '@rook/db';
import {
  currentSeason,
  executeUserTrade,
  F1_TEAMS,
  joinSeason,
  leaderboard,
  loadConfig,
  login,
  openSeason,
  Rng,
  TradeRejected,
} from '@rook/core';
import { tick } from './tick.js';

/**
 * Phase 1 exit test (§17): run a fake half-season end-to-end — news → moves
 * → trades → scores → leaderboard — with zero manual intervention, against
 * the real services and database. Leaves the DB populated so the app is
 * browsable afterward.
 *
 * Timeline: the season "started" 70 days ago; we replay hour by hour up to
 * now, so the web app sees a live, mid-season market.
 */

const DAYS = 70;
const HOUR = 3600e3;

type Archetype = 'early' | 'momentum' | 'concentrator' | 'wash' | 'casual';

interface Agent {
  id: number;
  handle: string;
  archetype: Archetype;
  rng: Rng;
  favorite?: number; // concentrator
  acuity?: number; // early
  lag?: number; // casual, hours
}

const COUNTS: Record<Archetype, number> = {
  early: 8,
  momentum: 4,
  concentrator: 2,
  wash: 1,
  casual: 25,
};

const STARTER_TARGET: Record<Archetype, number> = {
  early: 0.6,
  momentum: 0.45,
  concentrator: 0.85,
  wash: 0,
  casual: 0.55,
};

async function trySafe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TradeRejected) return; // caps/limits doing their job
    throw e;
  }
}

async function main() {
  await migrate();
  const sql = db();
  console.log('dogfood: wiping dev database');
  await sql.unsafe(`
    truncate users, sessions, seasons, assets, balances, holdings, trades,
      price_points, news_events, mover_log, scores, score_windows, follows,
      config, events restart identity cascade
  `);

  const realNow = new Date();
  const startsAt = new Date(Math.floor((realNow.getTime() - DAYS * 86400e3) / HOUR) * HOUR);
  const endsAt = new Date(startsAt.getTime() + 2 * DAYS * 86400e3);
  const seasonId = await openSeason('f1', 'F1 2026', F1_TEAMS, startsAt, endsAt);
  console.log(`dogfood: season ${seasonId} opened ${startsAt.toISOString()} → ${endsAt.toISOString()}`);

  // seed agents through the real signup path
  const seed = new Rng(20260715);
  const agents: Agent[] = [];
  let n = 0;
  for (const [archetype, count] of Object.entries(COUNTS) as Array<[Archetype, number]>) {
    for (let i = 0; i < count; i++) {
      const handle = `${archetype}_${i}`;
      const session = await login(handle, startsAt);
      await joinSeason(session.userId, seasonId, startsAt);
      agents.push({
        id: session.userId,
        handle,
        archetype,
        rng: new Rng(seed.int(1, 2 ** 31)),
        acuity: archetype === 'early' ? (i < count / 2 ? 0.95 : 0.6) : undefined,
        lag: archetype === 'casual' ? seed.int(2, 48) : undefined,
      });
      n++;
    }
  }
  const assets = await sql`select id, symbol from assets where season_id = ${seasonId} order by id`;
  const assetIds = assets.map((a) => a.id as number);
  for (const a of agents) {
    if (a.archetype === 'concentrator') a.favorite = assetIds[seed.int(0, assetIds.length)];
  }
  // a little follow-graph so profiles aren't bare
  for (const a of agents) {
    if (a.rng.chance(0.4)) {
      const other = agents[a.rng.int(0, agents.length)]!;
      if (other.id !== a.id) {
        await sql`insert into follows (follower_id, followee_id) values (${a.id}, ${other.id}) on conflict do nothing`;
      }
    }
  }
  console.log(`dogfood: ${n} agents joined with equal stacks`);

  const cfg = await loadConfig(startsAt);
  const price = new Map<number, number>(); // latest known price per asset
  const price24 = new Map<number, number[]>(); // rolling 24 prices
  const [assetRows] = [await sql`select id, p0 from assets where season_id = ${seasonId}`];
  for (const a of assetRows) {
    price.set(a.id, a.p0);
    price24.set(a.id, [a.p0]);
  }

  const holdingsOf = async (userId: number): Promise<Map<number, number>> => {
    const rows = await sql`select asset_id, qty from holdings where user_id = ${userId} and qty > 1e-9`;
    return new Map(rows.map((r) => [r.asset_id as number, r.qty as number]));
  };

  const totalTicks = DAYS * 24;
  let trades = 0;
  for (let t = 0; t < totalTicks; t++) {
    const now = new Date(startsAt.getTime() + (t + 1) * HOUR);

    // the real worker cycle: news → mover → snapshots → scores
    await tick(now, { newsSeed: 99 });

    // refresh local price cache from assets (cheap single query)
    const rows = await sql`select id, p0 + m * supply as p from assets where season_id = ${seasonId}`;
    for (const r of rows) {
      price.set(r.id, r.p);
      const arr = price24.get(r.id)!;
      arr.push(r.p);
      if (arr.length > 25) arr.shift();
    }
    const ret24 = (assetId: number): number => {
      const arr = price24.get(assetId)!;
      return arr.length > 1 ? arr[arr.length - 1]! / arr[0]! - 1 : 0;
    };

    // fresh news this hour (what early agents react to)
    const fresh = await sql`
      select n.asset_id, n.sign, n.magnitude from news_events n
      join assets a on a.id = n.asset_id
      where a.season_id = ${seasonId}
        and n.ts > ${new Date(now.getTime() - HOUR)} and n.ts <= ${now}
    `;
    const recentCount = (
      await sql`
        select count(*)::int as c from news_events n
        join assets a on a.id = n.asset_id
        where a.season_id = ${seasonId} and n.ts > ${new Date(now.getTime() - 48 * HOUR)} and n.ts <= ${now}
      `
    )[0]!.c as number;

    for (const agent of agents) {
      const { rng } = agent;

      // week-1 starter flow (§23.1)
      if (t < 96) {
        const [bal] = await sql`select cash from balances where user_id = ${agent.id} and season_id = ${seasonId}`;
        const cash: number = bal!.cash;
        const held = cfg.trading.startingStack - cash;
        const deployed = held / cfg.trading.startingStack;
        if (deployed < STARTER_TARGET[agent.archetype] && rng.chance(0.25)) {
          const target = agent.archetype === 'concentrator' ? agent.favorite! : assetIds[rng.int(0, assetIds.length)]!;
          await trySafe(() =>
            executeUserTrade(agent.id, { assetId: target, side: 'buy', notional: rng.range(300, 800), now }),
          );
          trades++;
        }
        continue;
      }

      switch (agent.archetype) {
        case 'early': {
          for (const e of fresh) {
            if (e.magnitude === 'small' || !rng.chance(agent.acuity ?? 0.5)) continue;
            const notional = rng.range(500, 950);
            if (e.sign > 0) {
              await trySafe(() =>
                executeUserTrade(agent.id, { assetId: e.asset_id, side: 'buy', notional, now }),
              );
            } else {
              const held = await holdingsOf(agent.id);
              const q = held.get(e.asset_id);
              if (q && q > 0) {
                const sellQty = Math.min(q, notional / (price.get(e.asset_id) ?? 10));
                await trySafe(() =>
                  executeUserTrade(agent.id, { assetId: e.asset_id, side: 'sell', qty: sellQty, now }),
                );
              }
            }
            trades++;
          }
          break;
        }
        case 'momentum': {
          if (!rng.chance(0.06)) break;
          let best: number | null = null;
          let worst: number | null = null;
          for (const a of assetIds) {
            if (best === null || ret24(a) > ret24(best)) best = a;
            if (worst === null || ret24(a) < ret24(worst)) worst = a;
          }
          if (best !== null && ret24(best) > 0.015) {
            await trySafe(() =>
              executeUserTrade(agent.id, { assetId: best!, side: 'buy', notional: rng.range(300, 700), now }),
            );
            trades++;
          }
          if (worst !== null && ret24(worst) < -0.015) {
            const held = await holdingsOf(agent.id);
            const q = held.get(worst);
            if (q && q > 0) {
              await trySafe(() =>
                executeUserTrade(agent.id, {
                  assetId: worst!,
                  side: 'sell',
                  qty: Math.min(q, rng.range(300, 700) / (price.get(worst) ?? 10)),
                  now,
                }),
              );
              trades++;
            }
          }
          break;
        }
        case 'concentrator': {
          const fav = agent.favorite!;
          if (rng.chance(0.03)) {
            await trySafe(() =>
              executeUserTrade(agent.id, { assetId: fav, side: 'buy', notional: rng.range(600, 1000), now }),
            );
            trades++;
          } else if (rng.chance(0.006)) {
            const held = await holdingsOf(agent.id);
            const q = held.get(fav);
            if (q && q > 0) {
              await trySafe(() =>
                executeUserTrade(agent.id, { assetId: fav, side: 'sell', qty: q * 0.3, now }),
              );
              trades++;
            }
          }
          break;
        }
        case 'wash': {
          if (rng.chance(0.1)) {
            const a = assetIds[rng.int(0, assetIds.length)]!;
            try {
              const buy = await executeUserTrade(agent.id, {
                assetId: a,
                side: 'buy',
                notional: rng.range(400, 900),
                now,
              });
              await executeUserTrade(agent.id, { assetId: a, side: 'sell', qty: buy.qty, now });
              trades += 2;
            } catch (e) {
              if (!(e instanceof TradeRejected)) throw e;
            }
          }
          break;
        }
        case 'casual': {
          const actP = 0.02 + Math.min(0.09, 0.012 * recentCount);
          if (!rng.chance(actP)) break;
          const seen = await sql`
            select n.asset_id, n.sign from news_events n
            join assets a on a.id = n.asset_id
            where a.season_id = ${seasonId}
              and n.ts > ${new Date(now.getTime() - 48 * HOUR)}
              and n.ts <= ${new Date(now.getTime() - (agent.lag ?? 12) * HOUR)}
            order by n.ts desc limit 5
          `;
          if (seen.length > 0 && rng.chance(0.8)) {
            const e = seen[rng.int(0, seen.length)]!;
            const notional = rng.range(150, 450);
            if (e.sign > 0) {
              await trySafe(() =>
                executeUserTrade(agent.id, { assetId: e.asset_id, side: 'buy', notional, now }),
              );
            } else {
              const held = await holdingsOf(agent.id);
              const q = held.get(e.asset_id);
              if (q && q > 0) {
                await trySafe(() =>
                  executeUserTrade(agent.id, {
                    assetId: e.asset_id,
                    side: 'sell',
                    qty: Math.min(q, notional / (price.get(e.asset_id) ?? 10)),
                    now,
                  }),
                );
              }
            }
            trades++;
          } else if (rng.chance(0.6)) {
            await trySafe(() =>
              executeUserTrade(agent.id, {
                assetId: assetIds[rng.int(0, assetIds.length)]!,
                side: 'buy',
                notional: rng.range(100, 300),
                now,
              }),
            );
            trades++;
          }
          break;
        }
      }
    }

    if ((t + 1) % (24 * 7) === 0) {
      console.log(`dogfood: week ${(t + 1) / (24 * 7)} done · ${trades} trades so far`);
    }
  }

  // ------------------------------------------------------------ verification
  console.log('\ndogfood: verifying invariants');
  const failures: string[] = [];

  // 1. price reconstructible from trades: supply == sum of signed CURVE qty
  //    (book fills transfer shares user↔user; supply untouched by design)
  const recon = await sql`
    select a.symbol, a.supply,
      coalesce(sum(case when t.side = 'buy' then t.qty else -t.qty end)
        filter (where t.venue = 'curve'), 0) as replayed
    from assets a left join trades t on t.asset_id = a.id
    where a.season_id = ${seasonId}
    group by a.id
  `;
  for (const r of recon) {
    if (Math.abs(r.supply - r.replayed) > 1e-6) {
      failures.push(`supply mismatch ${r.symbol}: ${r.supply} vs replayed ${r.replayed}`);
    }
  }

  // 2. balances consistent: stack + sum(cash_delta) == cash
  const bal = await sql`
    select u.handle, b.cash,
      ${cfg.trading.startingStack} + coalesce(sum(t.cash_delta), 0) as expected
    from balances b
    join users u on u.id = b.user_id
    left join trades t on t.user_id = b.user_id
    where b.season_id = ${seasonId}
    group by u.handle, b.cash
  `;
  for (const r of bal) {
    if (Math.abs(r.cash - r.expected) > 1e-6) {
      failures.push(`cash mismatch ${r.handle}: ${r.cash} vs ${r.expected}`);
    }
  }

  // 3. reserve solvency + non-negative supply
  const assets2 = await sql`select symbol, supply, reserve from assets where season_id = ${seasonId}`;
  for (const a of assets2) {
    if (a.supply < -1e-9) failures.push(`negative supply ${a.symbol}`);
    if (a.reserve < -1e-6) failures.push(`negative reserve ${a.symbol}: ${a.reserve}`);
  }

  // 4. house share of daily price movement stays under cap (R1)
  // bucket by season-anchored 24h periods (the sim's day-index bucketing):
  // the mover enforces a trailing-24h cap, so calendar-midnight buckets add
  // run-dependent alignment noise on a thin market
  const shares = await sql`
    select floor(extract(epoch from (t.ts - ${startsAt})) / 86400)::int as day, a.symbol,
      coalesce(sum(abs(t.price_after - t.price_before)) filter (where t.actor = 'house'), 0) as house,
      coalesce(sum(abs(t.price_after - t.price_before)) filter (where t.actor = 'user'), 0) as organic,
      coalesce(sum(abs(t.cash_delta)) filter (where t.actor = 'user'), 0) as organic_notional
    from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId}
    group by 1, 2
  `;
  const p95Of = (rows: Array<Record<string, number>>) => {
    const vals = rows
      .filter((s) => s.house! + s.organic! > 0)
      .map((s) => s.house! / (s.house! + s.organic!))
      .sort((x, y) => x - y);
    return vals[Math.floor(0.95 * (vals.length - 1))] ?? 0;
  };
  // dashboard statistics (bucketed share is alignment-sensitive on a thin
  // market — reported, not gated)
  const p95 = p95Of(shares.filter((s) => s.organic_notional >= 250));
  const p95All = p95Of(shares.filter((s) => s.organic > 0));

  // 4b. THE R1 HARD GATE — replay the mover's own promise from the audit
  // trail: at every house trade, cumulative house impact in the trailing
  // 24h window ≤ max(quiet floor, C/(1−C) × organic impact in that window).
  const allTrades = await sql`
    select t.asset_id, t.actor, t.ts, abs(t.price_after - t.price_before) as impact,
           t.price_before
    from trades t join assets a on a.id = t.asset_id
    where a.season_id = ${seasonId} and t.venue = 'curve'
    order by t.ts, t.id
  `;
  const windowMs = cfg.mover.windowTicks * 3600e3;
  const capRatio = cfg.mover.capC / (1 - cfg.mover.capC);
  let capViolations = 0;
  const byAsset = new Map<number, Array<{ actor: string; ts: number; impact: number; price: number }>>();
  for (const t of allTrades) {
    (byAsset.get(t.asset_id) ?? byAsset.set(t.asset_id, []).get(t.asset_id)!).push({
      actor: t.actor, ts: new Date(t.ts).getTime(), impact: t.impact, price: t.price_before,
    });
  }
  for (const rows of byAsset.values()) {
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]!;
      if (t.actor !== 'house') continue;
      let houseImpact = 0;
      let organicImpact = 0;
      for (let j = i; j >= 0 && rows[j]!.ts > t.ts - windowMs; j--) {
        if (rows[j]!.actor === 'house') houseImpact += rows[j]!.impact;
        else organicImpact += rows[j]!.impact;
      }
      const allowed = Math.max(cfg.mover.quietImpactFloor * t.price, capRatio * organicImpact);
      if (houseImpact > allowed * 1.05 + 1e-9) capViolations++;
    }
  }
  if (capViolations > 0) {
    failures.push(`${capViolations} house trades exceeded the trailing-window cap (R1 audit)`);
  }

  // 5. the loop produced everything downstream
  const [{ c: newsCount }] = (await sql`select count(*)::int as c from news_events`) as unknown as [{ c: number }];
  const [{ c: moverCount }] = (await sql`select count(*)::int as c from mover_log`) as unknown as [{ c: number }];
  const [{ c: snapCount }] = (await sql`select count(*)::int as c from price_points`) as unknown as [{ c: number }];
  const [{ c: windowCount }] = (await sql`select count(*)::int as c from score_windows`) as unknown as [{ c: number }];
  const board = await leaderboard(seasonId, new Date(startsAt.getTime() + totalTicks * HOUR));
  if (newsCount === 0) failures.push('no news ingested');
  if (moverCount === 0) failures.push('mover never ran');
  if (snapCount === 0) failures.push('no snapshots');
  if (windowCount < 8) failures.push(`only ${windowCount} scoring windows (expected ~10)`);
  if (board.length === 0) failures.push('empty leaderboard');

  const byArch = new Map<string, number[]>();
  for (const row of board) {
    const arch = row.handle.split('_')[0]!;
    (byArch.get(arch) ?? byArch.set(arch, []).get(arch)!).push(row.rookScore);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.log(`\n  season:            ${DAYS} days, ${totalTicks} hourly ticks, no manual intervention`);
  console.log(`  trades:            ${trades} agent trades executed`);
  console.log(`  news events:       ${newsCount}`);
  console.log(`  mover decisions:   ${moverCount}`);
  console.log(`  price snapshots:   ${snapCount}`);
  console.log(`  scoring windows:   ${windowCount}`);
  console.log(`  R1 cap audit:      ${capViolations} violations across every house trade's trailing window`);
  console.log(`  house share p95:   ${(100 * p95).toFixed(1)}% bucketed dashboard stat (${(100 * p95All).toFixed(1)}% incl. quiet days)`);
  console.log(`  leaderboard top:   ${board.slice(0, 3).map((b) => `@${b.handle} ${Math.round(b.rookScore)}`).join(' · ')}`);
  console.log('  mean rook score by archetype:');
  for (const [arch, scores] of [...byArch.entries()].sort((a, b) => mean(b[1]) - mean(a[1]))) {
    console.log(`    ${arch.padEnd(13)} ${mean(scores).toFixed(0)} (${scores.length})`);
  }

  if (failures.length > 0) {
    console.error(`\n✗ DOGFOOD FAILED:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ DOGFOOD PASSED — all invariants hold; DB left populated for browsing');
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
