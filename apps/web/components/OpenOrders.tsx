'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Order {
  id: number;
  side: string;
  limit_price: number;
  remaining: number;
  symbol: string;
  name: string;
  color: string;
}

export function OpenOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const router = useRouter();

  const load = () =>
    fetch('/api/orders').then(async (r) => {
      if (r.ok) setOrders(await r.json());
    });

  useEffect(() => {
    load();
  }, []);

  if (!orders || orders.length === 0) return null;

  const cancel = async (id: number) => {
    await fetch(`/api/orders/${id}`, { method: 'DELETE' });
    await load();
    router.refresh();
  };

  return (
    <>
      <h2>Open orders</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {orders.map((o, i) => (
          <div key={o.id} className="row" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: o.color }} />
              <span style={{ fontSize: 13.5 }}>
                <span className={o.side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 600 }}>
                  {o.side}
                </span>{' '}
                {Number(o.remaining).toFixed(1)} {o.symbol} @ ${Number(o.limit_price).toFixed(2)}
              </span>
            </span>
            <button
              onClick={() => cancel(o.id)}
              style={{ background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline' }}
            >
              cancel
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
