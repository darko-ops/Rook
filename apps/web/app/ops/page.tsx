import { betaMetrics, exitGates, loadConfig, nextRace } from '@rook/core';
import { activeSeason } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** The R1 / §18 dashboard. Aggregate numbers only — safe to leave open in beta. */
export default async function OpsPage() {
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const now = new Date();
  const [m, cfg, race] = await Promise.all([
    betaMetrics(season.id, now),
    loadConfig(now),
    nextRace(season.id, now),
  ]);
  const gates = exitGates(m, cfg.mover.capC);
  const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);

  const row = (label: string, value: string) => (
    <div className="row" style={{ padding: '9px 0', borderTop: '1px solid var(--border)' }}>
      <span className="muted" style={{ fontSize: 14 }}>{label}</span>
      <span className="num" style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Ops</h1>
        <div className="faint" style={{ fontSize: 13 }}>
          {season.name} · {m.joined} joined
          {race ? ` · next: ${race.name} ${new Date(race.race_at).toISOString().slice(0, 10)}` : ''}
        </div>
      </header>

      <h2>§18 exit gates</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {gates.map((g) => (
          <div key={g.name} className="row" style={{ padding: '10px 0' }}>
            <span style={{ fontSize: 13.5 }}>
              <span className={g.pass ? 'up' : 'down'}>{g.pass ? '✓' : '✗'}</span> {g.name}
            </span>
            <span className="num muted">{typeof g.value === 'number' ? g.value.toFixed(2) : 'n/a'}</span>
          </div>
        ))}
      </div>

      <h2>The loop</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {row('weekly actives', String(m.weeklyActives))}
        {row('daily-open rate (28d avg)', pct(m.dailyOpenRate))}
        {row('non-race-day open share', pct(m.nonRaceDayOpenShare))}
        {row('D1 / D7 / D30', `${pct(m.d1)} / ${pct(m.d7)} / ${pct(m.d30)}`)}
        {row('D7 friend-connected', pct(m.d7Connected))}
        {row('leaderboard views (median/wk)', String(m.leaderboardViewsMedian))}
        {row('trades per weekly active', m.tradesPerWeeklyActive.toFixed(1))}
        {row('follow density (edges/user)', m.followDensity.toFixed(2))}
      </div>

      <h2>R1 — house mover</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {row('house share p95 (active asset-days)', pct(m.houseShareP95))}
        {row('hard cap C', pct(cfg.mover.capC))}
      </div>
    </>
  );
}
