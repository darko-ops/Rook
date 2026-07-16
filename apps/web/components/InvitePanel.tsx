'use client';

import { useEffect, useState } from 'react';

interface Invites {
  quota: number;
  remaining: number;
  codes: Array<{ code: string; used: boolean }>;
}

/** §19 growth mechanic: users hand invites to friends, density stays high. */
export function InvitePanel() {
  const [inv, setInv] = useState<Invites | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/invites').then(async (r) => {
      if (r.ok) setInv(await r.json());
    });
  }, []);

  if (!inv || (inv.quota === 0 && inv.codes.length === 0)) return null;

  const mint = async () => {
    const res = await fetch('/api/invites', { method: 'POST' });
    if (res.ok) {
      const { code } = await res.json();
      setInv({ ...inv, remaining: inv.remaining - 1, codes: [...inv.codes, { code, used: false }] });
    }
  };

  const copy = (code: string) => {
    navigator.clipboard?.writeText(`Join me on Rook — the fantasy stock market for F1. Invite code: ${code} · ${location.origin}`);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <>
      <h2>Invite friends</h2>
      <div className="panel">
        <div className="row">
          <span className="muted" style={{ fontSize: 13.5 }}>
            {inv.remaining} invite{inv.remaining === 1 ? '' : 's'} left — rivalry needs rivals
          </span>
          {inv.remaining > 0 && (
            <button className="btn" onClick={mint} style={{ padding: '6px 12px', fontSize: 13 }}>
              New code
            </button>
          )}
        </div>
        {inv.codes.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {inv.codes.map((c) => (
              <div key={c.code} className="row" style={{ fontSize: 13.5 }}>
                <span className="num" style={{ letterSpacing: '0.06em', textDecoration: c.used ? 'line-through' : 'none', color: c.used ? 'var(--faint)' : 'var(--text)' }}>
                  {c.code}
                </span>
                {c.used ? (
                  <span className="faint" style={{ fontSize: 12 }}>used</span>
                ) : (
                  <button onClick={() => copy(c.code)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5 }}>
                    {copied === c.code ? 'copied ✓' : 'copy'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
