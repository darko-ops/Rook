import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@rook/db';
import { measure, newsFeed, priceHistory, track } from '@rook/core';
import { Delta, fmtMoney, fmtPct, Line } from '../../../components/charts';
import { TradeSheet } from '../../../components/TradeSheet';
import { activeSeason, sessionUser } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function MarketScreen(ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const now = new Date();
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const [asset] = await db()`
    select a.id, a.symbol, a.name, a.color, a.p0, a.m, a.supply,
           a.p0 + a.m * a.supply as price,
           s.position, s.points, s.wins, s.round
    from assets a
    left join standings s on s.asset_id = a.id and s.season_id = a.season_id
    where a.season_id = ${season.id} and a.symbol = ${symbol.toUpperCase()}
  `;
  if (!asset) notFound();

  const user = await sessionUser();
  const [m, news, history] = await Promise.all([
    measure(asset.id, season.id, now),
    newsFeed(season.id, now, asset.id, 15),
    priceHistory(asset.id, new Date(season.starts_at)),
  ]);
  if (user) await track('open:market', user.id, { symbol: asset.symbol });

  let heldQty = 0;
  let cash = 0;
  if (user) {
    const [h] = await db()`select qty from holdings where user_id = ${user.id} and asset_id = ${asset.id}`;
    heldQty = h?.qty ?? 0;
    const [b] = await db()`select cash from balances where user_id = ${user.id} and season_id = ${season.id}`;
    cash = b?.cash ?? 0;
  }

  const series: number[] = history.map((p) => p.price);
  const daySeries = series.slice(-24);
  const weekSeries = series.slice(-24 * 7);
  const ret24h = daySeries.length > 1 ? daySeries[daySeries.length - 1]! / daySeries[0]! - 1 : 0;
  const retSeason = asset.price / asset.p0 - 1;

  const metric = (label: string, value: string, cls = '') => (
    <div style={{ padding: '8px 0' }}>
      <div className="faint" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div className={`num ${cls}`} style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <Link href="/market" className="faint" style={{ fontSize: 13 }}>← Market</Link>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="row" style={{ gap: 10 }}>
            <span className="dot" style={{ background: asset.color, width: 12, height: 12 }} />
            <h1>{asset.name}</h1>
          </span>
          <span className="faint num">{asset.symbol}</span>
        </div>
        {asset.position != null && (
          <div className="badge" style={{ marginTop: 8 }}>
            P{asset.position} in the championship · {asset.points} pts
            {asset.wins ? ` · ${asset.wins} wins` : ''} · after round {asset.round}
          </div>
        )}
        <div className="num" style={{ fontSize: 30, fontWeight: 700, marginTop: 8 }}>
          {fmtMoney(asset.price)}
        </div>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 14, marginTop: 2 }}>
          <span><span className="faint" style={{ fontSize: 12 }}>24h </span><Delta value={ret24h} /></span>
          <span><span className="faint" style={{ fontSize: 12 }}>season </span><Delta value={retSeason} /></span>
        </div>
      </header>

      {weekSeries.length > 1 && (
        <div style={{ margin: '14px 0 6px' }}>
          <Line points={weekSeries} width={520} height={120} fill />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>last 7 days</div>
        </div>
      )}

      <div style={{ margin: '18px 0' }}>
        <TradeSheet
          assetId={asset.id}
          symbol={asset.symbol}
          heldQty={heldQty}
          cash={cash}
          signedIn={!!user}
        />
      </div>

      <h2>Measurement</h2>
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 16 }}>
        {metric('Momentum', `${m.momentum >= 0 ? '+' : ''}${(m.momentum * 100).toFixed(0)}`, m.momentum >= 0 ? 'up' : 'down')}
        {metric('Conviction', `${(m.conviction * 100).toFixed(0)}% buy`, m.conviction >= 0.5 ? 'up' : 'down')}
        {metric('Volatility', fmtPct(m.volatility, false))}
        {metric('Volume 24h', fmtMoney(m.volume24h))}
        {metric('Volume 7d', fmtMoney(m.volume7d))}
        {metric('vs league 7d', fmtPct(m.leagueRelative7d), m.leagueRelative7d >= 0 ? 'up' : 'down')}
        {metric('Holders', String(m.holders))}
        {metric('Top 10% hold', fmtPct(m.top10Share, false))}
        {metric('Whale trades 24h', String(m.whaleTrades.length))}
      </div>
      {m.whaleTrades.length > 0 && (
        <div className="panel" style={{ marginTop: 10, padding: '4px 16px' }}>
          {m.whaleTrades.slice(0, 5).map((w, i) => (
            <div key={i} className="row" style={{ padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <span className={`num ${w.side === 'buy' ? 'up' : 'down'}`} style={{ fontSize: 13.5, fontWeight: 600 }}>
                whale {w.side} {fmtMoney(w.notional)}
              </span>
              <span className="faint num" style={{ fontSize: 12.5 }}>
                moved {fmtPct(w.priceImpact, false)}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2>Why it moved</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {news.length === 0 && <div className="faint" style={{ padding: '12px 0', fontSize: 13.5 }}>No news yet.</div>}
        {news.map((n, i) => (
          <div key={n.id} style={{ padding: '11px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <div className="row">
              <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>{n.headline}</span>
              {n.sign && (
                <span className={n.sign > 0 ? 'up' : 'down'} style={{ fontSize: 13, flexShrink: 0 }}>
                  {n.sign > 0 ? '▲' : '▼'}
                </span>
              )}
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
              {new Date(n.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })} · {n.source}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
