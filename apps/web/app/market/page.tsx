import Link from 'next/link';
import { listAssets } from '@rook/core';
import { Delta, fmtMoney } from '../../components/charts';
import { activeSeason } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function MarketList() {
  const season = await activeSeason();
  if (!season) return <p style={{ paddingTop: 60 }}>No open season.</p>;
  const assets = await listAssets(season.id, new Date());

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>Market</h1>
        <div className="faint" style={{ fontSize: 13 }}>{season.name} · Formula 1</div>
      </header>
      <div className="panel" style={{ padding: '4px 16px', marginTop: 14 }}>
        {assets.map((a, i) => (
          <Link key={a.id} href={`/m/${a.symbol}`} className="row" style={{ padding: '13px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: a.color }} />
              <span>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</div>
                <div className="faint num" style={{ fontSize: 12.5 }}>{a.symbol}</div>
              </span>
            </span>
            <span style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontWeight: 600 }}>{fmtMoney(a.price)}</div>
              <Delta value={a.ret24h} />
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
