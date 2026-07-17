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
  const [mode, setMode] = useState<'market' | 'limit'>('market');
  const [notional, setNotional] = useState('250');
  const [limitPrice, setLimitPrice] = useState('');
  const [limitQty, setLimitQty] = useState('');
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
    if (mode === 'limit') {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId,
          side,
          limitPrice: Number(limitPrice),
          qty: Number(limitQty),
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setDone(
          body.restingQty > 0
            ? `${body.executedQty > 0 ? `Filled ${body.executedQty.toFixed(2)}, ` : ''}${body.restingQty.toFixed(2)} ${symbol} resting @ $${Number(limitPrice).toFixed(2)}`
            : `Filled ${body.executedQty.toFixed(2)} ${symbol}`,
        );
        router.refresh();
      } else {
        setError(body.error ?? 'order failed');
      }
      setBusy(false);
      return;
    }
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
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 12.5 }}>
        {(['market', 'limit'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontWeight: 600,
              color: mode === m ? 'var(--accent)' : 'var(--faint)',
              textDecoration: mode === m ? 'underline' : 'none',
            }}
          >
            {m === 'market' ? 'Market' : 'Limit'}
          </button>
        ))}
      </div>
      {mode === 'market' ? (
        <>
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
        </>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder={`limit price ($)`}
          />
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={limitQty}
            onChange={(e) => setLimitQty(e.target.value)}
            placeholder="shares"
          />
          <div className="faint" style={{ fontSize: 12 }}>
            Crossing part fills immediately (book &amp; curve, best price first);
            the rest waits on the book. {side === 'buy' ? 'Cash' : 'Shares'} held while open.
          </div>
        </div>
      )}
      <button
        className={`btn ${side}`}
        style={{ width: '100%', marginTop: 12 }}
        disabled={
          busy ||
          (mode === 'market'
            ? !quote || amount <= 0
            : !(Number(limitPrice) > 0) || !(Number(limitQty) > 0))
        }
        onClick={confirm}
      >
        {busy ? '…' : mode === 'market' ? `Confirm ${side}` : `Place limit ${side}`}
      </button>
      {error && <div className="down" style={{ fontSize: 13, marginTop: 8 }}>{error}</div>}
      {done && <div className="up" style={{ fontSize: 13, marginTop: 8 }}>{done}</div>}
      <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
        Quoted on the curve · max $1,000 per trade · <a href="/fairness" style={{ textDecoration: 'underline' }}>how prices work</a>
      </div>
    </div>
  );
}
