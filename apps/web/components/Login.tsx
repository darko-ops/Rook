'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function Login() {
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setError((await res.json()).error ?? 'login failed');
      setBusy(false);
    }
  };

  return (
    <div style={{ paddingTop: 96, textAlign: 'center' }}>
      <div className="brand" style={{ fontSize: 26 }}>
        R<span>OO</span>K
      </div>
      <p className="muted" style={{ margin: '10px 0 6px' }}>Own the season.</p>
      <p className="faint" style={{ fontSize: 13, marginBottom: 36 }}>
        Build a portfolio of the teams you believe in.
      </p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 320, margin: '0 auto' }}>
        <input
          type="text"
          placeholder="pick a handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoFocus
        />
        <button className="btn" disabled={busy || handle.length < 2}>
          Start the season — $10,000
        </button>
        {error && <div className="down" style={{ fontSize: 13 }}>{error}</div>}
      </form>
      <p className="faint" style={{ fontSize: 12, marginTop: 28 }}>
        Play money. Equal stacks. <a href="/fairness" style={{ textDecoration: 'underline' }}>How prices work</a>
      </p>
    </div>
  );
}
