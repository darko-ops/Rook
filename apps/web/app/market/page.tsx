import Link from 'next/link';
import { listAssets } from '@rook/core';
import { Delta, fmtMoney } from '../../components/charts';
import { activeSeason } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function MarketList(props: {
  searchParams: Promise<{ view?: string }>;
}) {
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const { view } = await props.searchParams;
  const kind = view === 'racers' ? 'driver' : 'team';
  const assets = await listAssets(season.id, new Date(), kind);
  const round = assets.find((a) => a.standing)?.standing?.round;

  const tab = (label: string, href: string, active: boolean) => (
    <Link
      href={href}
      style={{
        padding: '7px 16px',
        borderRadius: 9,
        fontSize: 13.5,
        fontWeight: 600,
        color: active ? 'var(--text)' : 'var(--muted)',
        background: active ? 'var(--panel-2)' : 'transparent',
        border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
      }}
    >
      {label}
    </Link>
  );

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Market</h1>
        <div className="faint" style={{ fontSize: 13 }}>
          {season.name} · Formula 1
          {round ? ` · championship after round ${round}` : ''}
        </div>
      </header>
      <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        {tab('Teams', '/market', kind === 'team')}
        {tab('Racers', '/market?view=racers', kind === 'driver')}
      </div>
      <div className="panel" style={{ padding: '4px 16px', marginTop: 12 }}>
        {assets.length === 0 && (
          <div className="faint" style={{ padding: '14px 0', fontSize: 13.5 }}>
            No {kind === 'driver' ? 'racer' : 'team'} assets in this season yet.
          </div>
        )}
        {assets.map((a, i) => (
          <Link key={a.id} href={`/m/${a.symbol}`} className="row" style={{ padding: '13px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: a.color }} />
              <span>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</div>
                <div className="faint num" style={{ fontSize: 12.5 }}>
                  {a.standing
                    ? `P${a.standing.position} · ${a.standing.points} pts${a.standing.wins ? ` · ${a.standing.wins} wins` : ''}${a.kind === 'driver' && a.teamSymbol ? ` · ${a.teamSymbol}` : ''}`
                    : a.symbol}
                </div>
              </span>
            </span>
            <span style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontWeight: 600 }}>{fmtMoney(a.price)}</div>
              <Delta value={a.ret24h} />
            </span>
          </Link>
        ))}
      </div>
      {assets.some((a) => a.standing) && (
        <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
          Standings are the sport. Prices are the market — set entirely by
          traders. When they disagree, that&apos;s your edge.
        </p>
      )}
    </>
  );
}
