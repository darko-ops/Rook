import Link from 'next/link';
import { leaderboard, track } from '@rook/core';
import { fmtPct } from '../../components/charts';
import { activeSeason, sessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function LeaderboardScreen() {
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const now = new Date();
  const rows = await leaderboard(season.id, now);
  const user = await sessionUser();
  if (user) await track('open:leaderboard', user.id);

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Leaderboard</h1>
        <div className="faint" style={{ fontSize: 13 }}>
          Top F1 investors · {season.name} · by Rook Score
        </div>
      </header>
      <div className="panel" style={{ padding: '4px 16px', marginTop: 14 }}>
        {rows.length === 0 && (
          <div className="faint" style={{ padding: '14px 0', fontSize: 13.5 }}>
            First scores land after the first scoring window.
          </div>
        )}
        {rows.map((r, i) => (
          <Link key={r.handle} href={`/t/${r.handle}`} className="row" style={{ padding: '12px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 12 }}>
              <span className="num faint" style={{ width: 24, fontSize: 13 }}>{i + 1}</span>
              <span>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                  {r.flair ? `${r.flair} ` : ''}@{r.handle}
                  {user?.handle === r.handle && <span className="faint"> · you</span>}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {r.rank}{r.provisional ? ' · provisional' : ''} · {r.followers} followers
                </div>
              </span>
            </span>
            <span style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontWeight: 700, color: 'var(--accent)' }}>{Math.round(r.rookScore)}</div>
              <div className={`num ${r.seasonReturn >= 0 ? 'up' : 'down'}`} style={{ fontSize: 12.5 }}>
                {fmtPct(r.seasonReturn)}
              </div>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
