'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const FREE = ['♟', '🏁', '🔥', '📈', '🦈', '🎯'];
const PRO = ['👑', '🐐', '💎', '🚀', '🏆', '⚡'];

export function FlairPicker({ current, plan }: { current: string | null; plan: 'free' | 'pro' }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const pick = async (flair: string | null) => {
    setBusy(true);
    await fetch('/api/flair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flair }),
    });
    router.refresh();
    setBusy(false);
  };

  const cell = (f: string, locked: boolean) => (
    <button
      key={f}
      disabled={busy || locked}
      onClick={() => pick(current === f ? null : f)}
      title={locked ? 'Opening Book flair' : ''}
      style={{
        fontSize: 20,
        padding: '6px 9px',
        borderRadius: 9,
        cursor: locked ? 'default' : 'pointer',
        opacity: locked ? 0.3 : 1,
        background: current === f ? 'var(--panel-2)' : 'transparent',
        border: `1px solid ${current === f ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      {f}
    </button>
  );

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Flair — pure plumage</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {FREE.map((f) => cell(f, false))}
        {PRO.map((f) => cell(f, plan !== 'pro'))}
      </div>
    </div>
  );
}
