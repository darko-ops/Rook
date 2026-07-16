import Link from 'next/link';
import { notFound } from 'next/navigation';
import { traderProfile } from '@rook/core';
import { fmtMoney, fmtPct } from '../../../components/charts';
import { FollowButton } from '../../../components/FollowButton';
import { activeSeason, sessionUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function TraderScreen(ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const viewer = await sessionUser();
  const p = await traderProfile(handle.toLowerCase(), season.id, new Date(), viewer?.id ?? null);
  if (!p) notFound();

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <Link href="/board" className="faint" style={{ fontSize: 13 }}>← Leaderboard</Link>
        <div className="row" style={{ marginTop: 10 }}>
          <h1>@{p.handle}</h1>
          <FollowButton handle={p.handle} isFollowing={p.isFollowing} self={viewer?.handle === p.handle} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 10, marginTop: 8 }}>
          <span className="badge">
            {p.rank ?? 'Rookie'}{p.provisional ? ' · provisional' : ''}
          </span>
          {p.rookScore !== null && (
            <span className="num" style={{ color: 'var(--accent)', fontWeight: 700 }}>
              {Math.round(p.rookScore)}
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>
          <span className={`num ${p.seasonReturn >= 0 ? 'up' : 'down'}`}>{fmtPct(p.seasonReturn)}</span> season
          · {p.followers} followers · {p.following} following
        </div>
      </header>

      <h2>Holdings</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {p.holdings.length === 0 && (
          <div className="faint" style={{ padding: '12px 0', fontSize: 13.5 }}>All cash right now.</div>
        )}
        {p.holdings.map((h, i) => (
          <Link key={h.symbol} href={`/m/${h.symbol}`} className="row" style={{ padding: '11px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: h.color }} />
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>{h.name}</span>
            </span>
            <span className="num" style={{ fontWeight: 600 }}>{fmtMoney(h.value)}</span>
          </Link>
        ))}
      </div>

      {p.career.length > 0 && (
        <>
          <h2>Career</h2>
          <div className="panel" style={{ padding: '4px 16px' }}>
            {p.career.map((c, i) => (
              <div key={c.season} className="row" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 14 }}>{c.season}</span>
                <span className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>{Math.round(c.rookScore)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
