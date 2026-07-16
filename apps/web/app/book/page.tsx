import { checkoutUrl, convictionBoard, ownershipTable, track, whaleTape } from '@rook/core';
import { fmtMoney, fmtPct } from '../../components/charts';
import { activeSeason, sessionUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Opening Book — the pro research surface (§25). Depth of sight, never edge. */
export default async function BookPage() {
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const user = await sessionUser();
  const now = new Date();

  if (!user || user.plan !== 'pro') {
    const url = await checkoutUrl(now);
    return (
      <div style={{ paddingTop: 80, textAlign: 'center' }}>
        <div className="badge" style={{ fontSize: 13 }}>Opening Book</div>
        <h1 style={{ margin: '18px 0 10px' }}>See the whole board</h1>
        <p className="muted" style={{ maxWidth: 380, margin: '0 auto', fontSize: 14.5, lineHeight: 1.6 }}>
          The league-wide whale tape, conviction flows, ownership
          concentration, full-season history, and data export. Depth of
          sight — never an edge the market itself doesn&apos;t have.
        </p>
        {url ? (
          <a className="btn" href={url} style={{ marginTop: 22, display: 'inline-block' }}>
            Upgrade to Pro
          </a>
        ) : (
          <p className="faint" style={{ marginTop: 22, fontSize: 13 }}>
            Pro access is invite-based during beta — ask in the group chat.
          </p>
        )}
        <p className="faint" style={{ fontSize: 12, marginTop: 26 }}>
          Fairness data — how prices work, the mover&apos;s log — is free forever. <a href="/fairness" style={{ textDecoration: 'underline' }}>See it →</a>
        </p>
      </div>
    );
  }

  const [tape, conviction, ownership] = await Promise.all([
    whaleTape(season.id, now, 20),
    convictionBoard(season.id, now),
    ownershipTable(season.id),
  ]);
  await track('open:book', user.id);

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Opening Book</h1>
        <div className="faint" style={{ fontSize: 13 }}>{season.name} · pro research</div>
      </header>

      <h2>Conviction — where the money leans</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {conviction.slice(0, 10).map((c, i) => (
          <a key={c.symbol} href={`/m/${c.symbol}`} className="row" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: c.color }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
            </span>
            <span style={{ textAlign: 'right' }}>
              <div className={`num ${c.netFlow24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 13.5, fontWeight: 600 }}>
                {c.netFlow24h >= 0 ? '+' : '−'}{fmtMoney(Math.abs(c.netFlow24h))} 24h
              </div>
              <div className="faint num" style={{ fontSize: 12 }}>{(100 * c.buyShare7d).toFixed(0)}% buy · 7d</div>
            </span>
          </a>
        ))}
      </div>

      <h2>Whale tape — market-moving trades, 7d</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {tape.length === 0 && <div className="faint" style={{ padding: '12px 0', fontSize: 13.5 }}>Quiet week.</div>}
        {tape.map((w, i) => (
          <div key={i} className="row" style={{ padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: w.color }} />
              <span className={`num ${w.side === 'buy' ? 'up' : 'down'}`} style={{ fontSize: 13.5, fontWeight: 600 }}>
                {w.symbol} {w.side} {fmtMoney(w.notional)}
              </span>
            </span>
            <span className="faint num" style={{ fontSize: 12 }}>
              moved {fmtPct(w.impact, false)} · {w.ts.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}
            </span>
          </div>
        ))}
      </div>

      <h2>Ownership — who holds the market</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {ownership.filter((o) => o.holders > 0).map((o, i) => (
          <div key={o.symbol} className="row" style={{ padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: o.color }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{o.symbol}</span>
            </span>
            <span className="faint num" style={{ fontSize: 12.5 }}>
              {o.holders} holders · top 10% own {fmtPct(o.top10Share, false)} · HHI {o.hhi.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
