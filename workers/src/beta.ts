import { closeDb, db, migrate } from '@rook/db';
import {
  admitWave,
  betaMetrics,
  currentSeason,
  exitGates,
  F1_TEAMS,
  grantInvites,
  loadConfig,
  mintInvites,
  nextRace,
  openSeason,
  seedRaces,
  sendEmail,
  settleSeason,
  syncStandings,
  waitlistStats,
} from '@rook/core';

/**
 * Phase 2 ops CLI:
 *   npm run -w workers beta -- open-season "F1 2026" 2026-12-13
 *   npm run -w workers beta -- invites 25
 *   npm run -w workers beta -- gate on|off
 *   npm run -w workers beta -- news rss|synthetic
 *   npm run -w workers beta -- metrics
 *   npm run -w workers beta -- settle <seasonId>
 */
async function main() {
  await migrate();
  const [cmd, ...args] = process.argv.slice(2);
  const now = new Date();

  switch (cmd) {
    case 'open-season': {
      const name = args[0] ?? 'F1 2026';
      const endsAt = new Date(args[1] ?? '2026-12-13T00:00:00Z');
      const seasonId = await openSeason('f1', name, F1_TEAMS, now, endsAt);
      const races = await seedRaces(seasonId);
      console.log(`season ${seasonId} "${name}" open until ${endsAt.toISOString()}; ${races} races seeded`);
      const next = await nextRace(seasonId, now);
      if (next) console.log(`next race: round ${next.round} ${next.name} @ ${new Date(next.race_at).toISOString()}`);
      break;
    }
    case 'invites': {
      const n = Number(args[0] ?? 10);
      const codes = await mintInvites(n, null);
      console.log(codes.join('\n'));
      break;
    }
    case 'gate': {
      const on = args[0] !== 'off';
      await setConfig2('beta', { inviteRequired: on }, now);
      console.log(`invite gate: ${on ? 'ON' : 'OFF'}`);
      break;
    }
    case 'news': {
      const mode = args[0] === 'rss' ? 'rss' : 'synthetic';
      await setConfig2('news', { mode }, now);
      console.log(`news source: ${mode}`);
      break;
    }
    case 'metrics': {
      const season = await currentSeason(now);
      if (!season) throw new Error('no open season');
      const cfg = await loadConfig(now);
      const m = await betaMetrics(season.id, now);
      const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);
      console.log(`beta metrics — ${season.name} — as of ${now.toISOString()}`);
      console.log(`  joined:                    ${m.joined}`);
      console.log(`  weekly actives:            ${m.weeklyActives}`);
      console.log(`  daily-open rate (28d avg): ${pct(m.dailyOpenRate)}`);
      console.log(`  non-race-day open share:   ${pct(m.nonRaceDayOpenShare)}`);
      console.log(`  D1 / D7 / D30:             ${pct(m.d1)} / ${pct(m.d7)} / ${pct(m.d30)}`);
      console.log(`  D7 (friend-connected):     ${pct(m.d7Connected)}`);
      console.log(`  leaderboard views (med):   ${m.leaderboardViewsMedian}/wk`);
      console.log(`  trades per weekly active:  ${m.tradesPerWeeklyActive.toFixed(1)}`);
      console.log(`  follow density:            ${m.followDensity.toFixed(2)} edges/user`);
      console.log(`  house share p95 (R1):      ${pct(m.houseShareP95)}`);
      console.log('\n§18 exit gates:');
      for (const g of exitGates(m, cfg.mover.capC)) {
        const v = typeof g.value === 'number' ? g.value.toFixed(2) : 'n/a';
        console.log(`  ${g.pass ? '✓' : '✗'} ${g.name} — ${v}`);
      }
      break;
    }
    case 'auth': {
      const on = args[0] === 'magic';
      await setConfig2('auth', { magicLink: on }, now);
      console.log(`auth: ${on ? 'magic-link (email)' : 'handle-only (dev/beta)'}`);
      break;
    }
    case 'grant-invites': {
      const quota = Number(args[0] ?? 3);
      const n = await grantInvites(quota);
      console.log(`invite quota set to ≥${quota} for ${n} users`);
      break;
    }
    case 'waitlist': {
      const s = await waitlistStats();
      console.log(`waiting: ${s.waiting} · invited: ${s.invited} · joined: ${s.joined}`);
      break;
    }
    case 'admit-wave': {
      const n = Number(args[0] ?? 25);
      const baseUrl = process.env.PUBLIC_URL ?? 'http://localhost:3300';
      const admitted = await admitWave(n);
      for (const a of admitted) {
        await sendEmail({
          to: a.email,
          subject: "You're in — your Rook invite",
          text: `Your invite code: ${a.code}\n\nJoin at ${baseUrl} — pick a handle, enter the code, and you start with the same $10,000 as everyone else.\n\nRook — Own the season.`,
        });
      }
      console.log(`admitted ${admitted.length} from the waitlist (codes emailed; dev mode logs them above)`);
      break;
    }
    case 'data-key': {
      const name = args[0];
      if (!name) throw new Error('usage: data-key <licensee-name> [dailyLimit]');
      const { mintApiKey } = await import('@rook/core');
      const key = await mintApiKey(name, Number(args[1] ?? 1000));
      console.log(key);
      break;
    }
    case 'index-backfill': {
      const season = await currentSeason(now);
      if (!season) throw new Error('no open season');
      // rebuild index_points from historical snapshots: cap-weighted average
      // price vs the flat start (100 = league at p0)
      await db()`delete from index_points where season_id = ${season.id}`;
      await db()`
        insert into index_points (season_id, ts, market_cap, value)
        select ${season.id}, p.ts, sum(p.price * p.supply),
               100 * (sum(p.price * p.supply) / sum(p.supply))
                   / (select avg(p0) from assets where season_id = ${season.id})
        from price_points p join assets a on a.id = p.asset_id
        where a.season_id = ${season.id}
        group by p.ts having sum(p.supply) > 0
        order by p.ts
      `;
      const [{ n }] = (await db()`
        select count(*)::int as n from index_points where season_id = ${season.id}
      `) as unknown as [{ n: number }];
      console.log(`index backfilled: ${n} points`);
      break;
    }
    case 'plan': {
      const [handle, plan] = args;
      if (!handle || (plan !== 'free' && plan !== 'pro')) throw new Error('usage: plan <handle> free|pro');
      const { setPlan } = await import('@rook/core');
      await setPlan(handle, plan);
      console.log(`@${handle} → ${plan}`);
      break;
    }
    case 'add-drivers': {
      const season = await currentSeason(now);
      if (!season) throw new Error('no open season');
      const { addDriversToSeason } = await import('@rook/core');
      const added = await addDriversToSeason(season.id, now);
      console.log(`${added} driver assets added at flat p0 (market ranks them from here)`);
      break;
    }
    case 'standings': {
      const season = await currentSeason(now);
      if (!season) throw new Error('no open season');
      const res = await syncStandings(season.id, now);
      console.log(`sync: ${res.synced ? 'fetched' : 'throttled/cached'} · ${res.events} result events emitted`);
      const table = await db()`
        select s.position, a.name, s.points, s.wins, a.p0 + a.m * a.supply as price
        from standings s join assets a on a.id = s.asset_id
        where s.season_id = ${season.id} order by s.position
      `;
      console.log('pos  team              pts    wins  market price');
      for (const r of table) {
        console.log(
          `P${String(r.position).padEnd(3)} ${String(r.name).padEnd(17)} ${String(r.points).padEnd(6)} ${String(r.wins).padEnd(5)} $${Number(r.price).toFixed(2)}`,
        );
      }
      break;
    }
    case 'settle': {
      const seasonId = Number(args[0]);
      if (!seasonId) throw new Error('usage: settle <seasonId>');
      await settleSeason(seasonId, now);
      console.log(`season ${seasonId} settled at final-week TWAP`);
      break;
    }
    case 'settlement': {
      const mode = args[0] === 'standings' ? 'standings' : 'twap';
      await setConfig2('engine', { settlement: { mode } }, now);
      console.log(`settlement mode: ${mode} (decision H — disclosed on /fairness and asset pages)`);
      break;
    }
    case 'rollover': {
      const season = await currentSeason(now);
      if (!season) throw new Error('no open season');
      const newName = args[0] ?? `${season.name} → next`;
      const endsAt = new Date(args[1] ?? now.getTime() + 200 * 86400e3);
      const { rolloverSeason, seedRaces: seed } = await import('@rook/core');
      const newId = await rolloverSeason(season.id, newName, now, endsAt, now);
      await seed(newId);
      console.log(
        `season ${season.id} settled · season ${newId} "${newName}" open — fresh stacks issued, Rook Scores carried`,
      );
      break;
    }
    default:
      console.log(
        'commands: open-season | invites | gate on|off | news rss|synthetic | auth magic|handle | grant-invites [n] | waitlist | admit-wave [n] | add-drivers | standings | plan <handle> free|pro | metrics | settle',
      );
  }
  await closeDb();
}

async function setConfig2(key: string, value: object, now: Date): Promise<void> {
  await db()`insert into config (key, value, effective_at)
    values (${key}, ${db().json(JSON.parse(JSON.stringify(value)))}, ${now})`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
