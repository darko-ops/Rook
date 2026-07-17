import { CONSTRUCTOR_TO_SYMBOL, F1_TEAMS, raceSchedule, track } from '@rook/core';
import type { RaceResultRow } from '@rook/core';
import { TrackMap } from '../../components/TrackMap';
import { activeSeason, sessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

const TEAM_COLOR = new Map(F1_TEAMS.map((t) => [t.symbol, t.color]));
const colorOf = (constructorId: string): string =>
  TEAM_COLOR.get(CONSTRUCTOR_TO_SYMBOL[constructorId] ?? '') ?? '#888';

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtTime(d: Date): string {
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default async function RacesScreen() {
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const now = new Date();
  const races = await raceSchedule(season.id);
  const user = await sessionUser();
  if (user) await track('open:races', user.id);

  const completed = races.filter((r) => new Date(r.race_at) < now && r.results);
  const awaiting = races.filter((r) => new Date(r.race_at) < now && !r.results);
  const upcoming = races.filter((r) => new Date(r.race_at) >= now);
  const next = upcoming[0];
  const rest = upcoming.slice(1);

  const place = (r: { locality?: string; country?: string; circuit?: string }) =>
    [r.circuit, [r.locality, r.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Races</h1>
        <div className="faint" style={{ fontSize: 13 }}>
          {season.name} · {completed.length + awaiting.length} of {races.length} rounds run
        </div>
      </header>

      {next && (
        <>
          <h2>Next up</h2>
          <div className="panel row" style={{ borderColor: 'var(--accent)', alignItems: 'flex-start', gap: 16 }}>
            <TrackMap round={next.round} size={130} />
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Round {next.round} · in {Math.ceil((new Date(next.race_at).getTime() - now.getTime()) / 86400e3)} days
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 3 }}>{next.name}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{place(next)}</div>
              <table className="sheet" style={{ marginTop: 8 }}>
                <tbody>
                  <tr><td className="muted">Qualifying</td><td className="num">{fmtTime(new Date(next.quali_at))}</td></tr>
                  <tr><td className="muted">Race</td><td className="num">{fmtTime(new Date(next.race_at))}</td></tr>
                </tbody>
              </table>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                Results move the championship — and the settlement anchor.
              </div>
            </div>
          </div>
        </>
      )}

      {(completed.length > 0 || awaiting.length > 0) && (
        <>
          <h2>Race history</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {[...completed].reverse().map((r) => {
              const results = (r.results ?? []) as RaceResultRow[];
              const podium = results.slice(0, 3);
              const winner = podium[0];
              return (
                <div key={r.round} className="panel row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  <TrackMap round={r.round} size={86} />
                  <div style={{ flex: 1 }}>
                    <div className="row">
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                      <span className="faint num" style={{ fontSize: 12 }}>
                        R{r.round} · {fmtDate(new Date(r.race_at))}
                      </span>
                    </div>
                    <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{place(r)}</div>
                    {winner && (
                      <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                        {podium.map((p) => (
                          <div key={p.pos} className="row" style={{ fontSize: 13 }}>
                            <span className="row" style={{ gap: 8 }}>
                              <span className="num faint" style={{ width: 14 }}>{p.pos}</span>
                              <span className="dot" style={{ background: colorOf(p.constructorId) }} />
                              <span style={{ fontWeight: p.pos === 1 ? 700 : 500 }}>
                                {p.driver}
                                {p.pos === 1 ? ' 🏆' : ''}
                              </span>
                            </span>
                            <span className="num faint" style={{ fontSize: 12 }}>{p.points} pts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {awaiting.map((r) => (
              <div key={r.round} className="panel row" style={{ gap: 14 }}>
                <TrackMap round={r.round} size={64} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    R{r.round} · {fmtDate(new Date(r.race_at))} · results pending sync
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <h2>Ahead</h2>
          <div className="panel" style={{ padding: '4px 16px' }}>
            {rest.map((r, i) => (
              <div key={r.round} className="row" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none', gap: 12 }}>
                <span className="row" style={{ gap: 12 }}>
                  <TrackMap round={r.round} size={44} />
                  <span>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{place(r)}</div>
                  </span>
                </span>
                <span className="num faint" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  R{r.round} · {fmtDate(new Date(r.race_at))}
                </span>
              </div>
            ))}
          </div>
          <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Track maps are stylized, not scale layouts. Schedule and results
            sync from the live timing feed every few hours.
          </p>
        </>
      )}
    </>
  );
}
