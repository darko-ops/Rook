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
    case 'settle': {
      const seasonId = Number(args[0]);
      if (!seasonId) throw new Error('usage: settle <seasonId>');
      await settleSeason(seasonId, now);
      console.log(`season ${seasonId} settled at final-week TWAP`);
      break;
    }
    default:
      console.log(
        'commands: open-season | invites | gate on|off | news rss|synthetic | auth magic|handle | grant-invites [n] | waitlist | admit-wave [n] | metrics | settle',
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
