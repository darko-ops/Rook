import Link from 'next/link';
import {
  betaGateEnabled,
  listAssets,
  magicLinkEnabled,
  newsFeed,
  portfolio,
  track,
} from '@rook/core';
import { Delta, fmtMoney, fmtPct, Line } from '../components/charts';
import { InvitePanel } from '../components/InvitePanel';
import { Landing } from '../components/Landing';
import { OpenOrders } from '../components/OpenOrders';
import { PushToggle } from '../components/PushToggle';
import { activeSeason, sessionUser } from '../lib/session';

export const dynamic = 'force-dynamic';

export default async function PortfolioScreen(props: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const user = await sessionUser();
  const now = new Date();
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  if (!user) {
    const [assets, gate, magic, params] = await Promise.all([
      listAssets(season.id, now, 'team'),
      betaGateEnabled(now),
      magicLinkEnabled(now),
      props.searchParams,
    ]);
    return (
      <Landing
        assets={assets}
        inviteRequired={gate}
        magicLink={magic}
        authError={params.auth_error}
      />
    );
  }

  const [view, assets, news] = await Promise.all([
    portfolio(user.id, season.id, now),
    listAssets(season.id, now),
    newsFeed(season.id, now, undefined, 8),
    track('open:portfolio', user.id),
  ]).then(([v, a, n]) => [v, a, n] as const);
  if (!view) return <p style={{ paddingTop: 60 }}>No season balance — refresh after joining.</p>;

  const movers = [...assets].sort((a, b) => Math.abs(b.ret24h) - Math.abs(a.ret24h)).slice(0, 3);
  const headlineFor = (assetSymbol: string) =>
    news.find((n) => n.symbol === assetSymbol)?.headline ?? null;
  const seasonDelta = view.totalValue - 10_000;

  return (
    <>
      <header className="row" style={{ padding: '22px 0 4px' }}>
        <span className="brand">R<span>OO</span>K</span>
        <span className="row" style={{ gap: 10 }}>
          <PushToggle />
          <Link href={`/t/${user.handle}`} className="badge">
            {view.rank ?? 'Rookie'}{view.provisional ? ' ·  provisional' : ''}
            {view.rookScore !== null ? ` · ${Math.round(view.rookScore)}` : ''}
          </Link>
        </span>
      </header>

      <section style={{ padding: '18px 0 6px' }}>
        <div className="muted" style={{ fontSize: 13 }}>Portfolio</div>
        <div className="num" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {fmtMoney(view.totalValue)}
        </div>
        <div className={`num ${seasonDelta >= 0 ? 'up' : 'down'}`} style={{ fontSize: 15, fontWeight: 600 }}>
          {seasonDelta >= 0 ? '+' : '−'}{fmtMoney(Math.abs(seasonDelta)).slice(1)} ({fmtPct(view.seasonReturn)}) season
        </div>
        {view.sparkline.length > 1 && (
          <div style={{ marginTop: 14 }}>
            <Line points={view.sparkline} width={520} height={56} fill />
          </div>
        )}
      </section>

      {(() => {
        const daysLeft = (new Date(season.ends_at).getTime() - now.getTime()) / 86400e3;
        if (daysLeft > 7 || daysLeft <= 0) return null;
        return (
          <section className="panel" style={{ marginTop: 18, borderColor: 'var(--accent)' }}>
            <div style={{ fontWeight: 700 }}>♟ Endgame — {Math.ceil(daysLeft)} day{Math.ceil(daysLeft) === 1 ? '' : 's'} left</div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 4 }}>
              Every asset settles at its average price over this final week —
              last-minute pumps wash out. Your season return becomes career
              record; everyone starts next season with a fresh $10,000.
            </p>
          </section>
        );
      })()}

      {view.holdings.length === 0 && (
        <section className="panel" style={{ marginTop: 18, borderColor: 'var(--accent)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Open your first positions</div>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            Every player starts this season with the same $10,000. Pick the teams
            you believe in — prices move on what the market does next.
          </p>
          <Link href="/market" className="btn" style={{ marginTop: 12 }}>
            Browse the market
          </Link>
        </section>
      )}

      <h2>Today&apos;s movers</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {movers.map((a, i) => (
          <Link key={a.id} href={`/m/${a.symbol}`} className="row" style={{ padding: '11px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: a.color }} />
              <span>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.name}</div>
                {headlineFor(a.symbol) && (
                  <div className="faint" style={{ fontSize: 12.5, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {headlineFor(a.symbol)}
                  </div>
                )}
              </span>
            </span>
            <Delta value={a.ret24h} />
          </Link>
        ))}
      </div>

      {view.holdings.length > 0 && (
        <>
          <h2>Holdings</h2>
          <div className="panel" style={{ padding: '4px 16px' }}>
            {view.holdings.map((h, i) => (
              <Link key={h.assetId} href={`/m/${h.symbol}`} className="row" style={{ padding: '12px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="dot" style={{ background: h.color }} />
                  <span>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{h.name}</div>
                    <div className="faint num" style={{ fontSize: 12.5 }}>
                      {h.qty.toFixed(1)} sh · {fmtMoney(h.price)}
                    </div>
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontWeight: 600, fontSize: 14.5 }}>{fmtMoney(h.value)}</div>
                  <Delta value={h.dayChange} />
                </span>
              </Link>
            ))}
            <div className="row" style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <span className="muted" style={{ fontSize: 14 }}>Cash</span>
              <span className="num muted" style={{ fontSize: 14 }}>{fmtMoney(view.cash)}</span>
            </div>
          </div>
        </>
      )}

      <OpenOrders />

      <InvitePanel />
    </>
  );
}
