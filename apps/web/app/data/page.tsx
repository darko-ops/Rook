import { indexSeries, recentMoments } from '@rook/core';
import { fmtPct } from '../../components/charts';
import { activeSeason } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Rook Data — the licensable measurement layer (§27). Public pitch page
 * with live samples; access is keyed. The CFTC itself cites price
 * discovery and commercial forecasting as the public-interest case for
 * event markets — this page is that story with an API attached.
 */
export default async function DataPage() {
  const season = await activeSeason();
  const now = new Date();
  const [idx, moments] = season
    ? await Promise.all([
        indexSeries(season.id, new Date(now.getTime() - 7 * 86400e3)),
        recentMoments(season.id, 5),
      ])
    : [[], []];
  const idxNow = idx[idx.length - 1]?.value as number | undefined;

  const endpoint = (method: string, path: string, desc: string) => (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div className="num" style={{ fontSize: 13.5, fontWeight: 600 }}>
        <span style={{ color: 'var(--accent)' }}>{method}</span> {path}
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{desc}</div>
    </div>
  );

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Rook Data</h1>
        <div className="faint" style={{ fontSize: 13 }}>
          The measurement layer, licensed — fan sentiment as market data
        </div>
      </header>

      <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6, marginTop: 14 }}>
        Every price on Rook is set by fans trading with equal stacks — a
        continuous, season-long measure of where conviction actually sits.
        The audit trail behind it is licensable: index feeds, per-team and
        per-driver sentiment series, and market-moment detection built for
        broadcast graphics and editorial.
      </p>

      {idxNow !== undefined && (
        <div className="panel row" style={{ marginTop: 18 }}>
          <span>
            <div className="faint" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rook Index · live</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 700 }}>{idxNow.toFixed(1)}</div>
          </span>
          <span className="faint" style={{ fontSize: 12 }}>100 = season open</span>
        </div>
      )}

      {moments.length > 0 && (
        <>
          <h2>Market moments · live sample</h2>
          <div className="panel" style={{ padding: '4px 16px' }}>
            {moments.map((m, i) => (
              <div key={i} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div className="row">
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</span>
                  <span className={`num ${m.ret >= 0 ? 'up' : 'down'}`} style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {fmtPct(m.ret)} / {m.window_hours}h
                  </span>
                </div>
                <div className="faint" style={{ fontSize: 12.5, marginTop: 3 }}>{m.headline}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>API v1</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {endpoint('GET', '/api/data/v1/index?days=30', 'Rook Index time series (cap-weighted, 100 at season open)')}
        {endpoint('GET', '/api/data/v1/assets', 'Full catalog: prices, returns, volumes, real championship standings')}
        {endpoint('GET', '/api/data/v1/assets/MER/series?days=30', 'Per-asset hourly prices + daily sentiment (net flow, volume, buy share)')}
        {endpoint('GET', '/api/data/v1/moments', 'Significant moves with attribution — built for broadcast graphics')}
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
        Auth: <span className="num">x-rook-key</span> header · per-key daily limits ·
        JSON. Keys for media, sponsors, and analytics partners:{' '}
        <a href="mailto:data@rook.ai" style={{ textDecoration: 'underline' }}>data@rook.ai</a>
      </p>

      <div className="panel" style={{ marginTop: 20, borderColor: 'var(--accent)' }}>
        <strong>What this is not.</strong>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 5, lineHeight: 1.55 }}>
          No odds, no predictions, no gambling nexus. Rook Data measures what
          a fair market of fans does — price discovery and sentiment, the
          same public-interest uses regulators cite for event markets. Every
          number derives from a disclosed, auditable trade log.
        </p>
      </div>
    </>
  );
}
