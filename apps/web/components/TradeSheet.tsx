'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  assetId: number;
  symbol: string;
  heldQty: number;
  cash: number;
  signedIn: boolean;
}

/**
 * Buy/Sell with the curve-quoted cost shown before confirm — no surprise
 * pricing (§10 fairness doctrine). Plain finance verbs only.
 */
export function TradeSheet({ assetId, symbol, heldQty, cash, signedIn }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [notional, setNotional] = useState('250');
  const [quote, setQuote] = useState<{ qty: number; effectivePrice: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const amount = Number(notional) || 0;

  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!(amount > 0)) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/assets/${assetId}/quote?side=${side}&notional=${amount}`);
      if (res.ok) setQuote(await res.json());
    }, 150);
    return () => clearTimeout(t);
  }, [assetId, side, amount]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch(`/api/assets/${assetId}/trade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ side, notional: amount }),
    });
    const body = await res.json();
    if (res.ok) {
      setDone(
        `${side === 'buy' ? 'Bought' : 'Sold'} ${body.qty.toFixed(2)} ${symbol} @ $${(
          Math.abs(body.cashDelta) / body.qty
        ).toFixed(2)}`,
      );
      router.refresh();
    } else {
      setError(body.error ?? 'trade failed');
    }
    setBusy(false);
  };

  if (!signedIn) {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <a href="/" style={{ fontWeight: 600 }}>Sign in to trade</a>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn ${side === 'buy' ? 'buy' : ''}`} onClick={() => setSide('buy')}>
            Buy
          </button>
          <button className={`btn ${side === 'sell' ? 'sell' : ''}`} onClick={() => setSide('sell')}>
            Sell
          </button>
        </div>
        <span className="faint num" style={{ fontSize: 12.5 }}>
          {side === 'buy' ? `$${cash.toFixed(0)} cash` : `${heldQty.toFixed(1)} sh held`}
        </span>
      </div>
      <input
        type="number"
        min="1"
        step="1"
        value={notional}
        onChange={(e) => setNotional(e.target.value)}
        placeholder="amount in $"
      />
      <table className="sheet" style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <td className="muted">{side === 'buy' ? 'You pay' : 'You receive'}</td>
            <td className="num">${amount.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="muted">{side === 'buy' ? 'You get' : 'You sell'}</td>
            <td className="num">{quote ? `${quote.qty.toFixed(2)} shares` : '—'}</td>
          </tr>
          <tr>
            <td className="muted">Effective price</td>
            <td className="num">{quote ? `$${quote.effectivePrice.toFixed(2)}` : '—'}</td>
          </tr>
        </tbody>
      </table>
      <button
        className={`btn ${side}`}
        style={{ width: '100%', marginTop: 12 }}
        disabled={busy || !quote || amount <= 0}
        onClick={confirm}
      >
        {busy ? '…' : `Confirm ${side}`}
      </button>
      {error && <div className="down" style={{ fontSize: 13, marginTop: 8 }}>{error}</div>}
      {done && <div className="up" style={{ fontSize: 13, marginTop: 8 }}>{done}</div>}
      <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
        Quoted on the curve · max $1,000 per trade · <a href="/fairness" style={{ textDecoration: 'underline' }}>how prices work</a>
      </div>
    </div>
  );
}
