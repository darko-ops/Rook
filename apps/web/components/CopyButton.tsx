'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Copy-trading toggle (§25 v2). Copied trades run through the normal trade
 * path — same caps, same rate limits — sized to your portfolio, and every
 * one is tagged with its origin in the audit trail.
 */
export function CopyButton({ handle, isCopying, self }: { handle: string; isCopying: boolean; self: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (self) return null;

  const toggle = async () => {
    setBusy(true);
    await fetch(`/api/traders/${handle}/copy`, { method: isCopying ? 'DELETE' : 'POST' });
    router.refresh();
    setBusy(false);
  };

  return (
    <button
      className="btn"
      disabled={busy}
      onClick={toggle}
      style={isCopying ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
      title="Automatically mirror this trader's moves, scaled to your stack"
    >
      {isCopying ? 'Copying ✓' : 'Copy trades'}
    </button>
  );
}
