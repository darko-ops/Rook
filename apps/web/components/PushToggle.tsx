'use client';

import { useEffect, useState } from 'react';

function b64ToU8(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Your portfolio moved" — the daily-open loop's push lever (§25). */
export function PushToggle() {
  const [state, setState] = useState<'unsupported' | 'off' | 'on' | 'busy'>('busy');

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  if (state === 'unsupported') return null;

  const toggle = async () => {
    setState('busy');
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await fetch('/api/push', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      await existing.unsubscribe();
      setState('off');
      return;
    }
    try {
      const { publicKey } = await (await fetch('/api/push')).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToU8(publicKey),
      });
      const res = await fetch('/api/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      setState(res.ok ? 'on' : 'off');
    } catch {
      setState('off');
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={state === 'busy'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: state === 'on' ? 'var(--accent)' : 'var(--faint)', fontSize: 13 }}
      title={state === 'on' ? 'Notifications on' : 'Notify me when my portfolio moves'}
    >
      {state === 'on' ? '🔔 on' : '🔕 notify me'}
    </button>
  );
}
