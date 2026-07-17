'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AssetStrip {
  symbol: string;
  name: string;
  color: string;
  price: number;
  ret24h: number;
}

interface Props {
  assets: AssetStrip[];
  inviteRequired: boolean;
  magicLink: boolean;
  authError?: string;
}

function JoinForm({ inviteRequired, magicLink }: { inviteRequired: boolean; magicLink: boolean }) {
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState('');
  const [needsInvite, setNeedsInvite] = useState(inviteRequired);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle,
        email: email || undefined,
        invite: invite || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.sent) {
      setSent(true);
    } else if (res.ok) {
      router.refresh();
    } else {
      if (body.code === 'invite-required') setNeedsInvite(true);
      setError(body.error ?? 'failed');
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700 }}>Check your email</div>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
          Your sign-in link for @{handle} is on its way. It expires in 30 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
      <input type="text" placeholder="pick a handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
      {magicLink && (
        <input type="text" inputMode="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      )}
      {needsInvite && (
        <input type="text" placeholder="invite code" value={invite} onChange={(e) => setInvite(e.target.value)} />
      )}
      <button className="btn buy" disabled={busy || handle.length < 2 || (magicLink && !email)}>
        Start the season — $10,000
      </button>
      {error && <div className="down" style={{ fontSize: 13 }}>{error}</div>}
    </form>
  );
}

function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();
    if (res.ok) setPosition(body.position);
    else setError(body.error ?? 'failed');
    setBusy(false);
  };

  if (position !== null) {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700 }}>You&apos;re #{position} in line</div>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
          Invites go out in waves. Friends with an invite get you in faster.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
      <input type="text" inputMode="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn" disabled={busy || !email.includes('@')}>Join the waitlist</button>
      {error && <div className="down" style={{ fontSize: 13 }}>{error}</div>}
    </form>
  );
}

export function Landing({ assets, inviteRequired, magicLink, authError }: Props) {
  const [showJoin, setShowJoin] = useState(!inviteRequired);

  return (
    <div style={{ paddingTop: 64 }}>
      <div style={{ textAlign: 'center' }}>
        <div className="brand" style={{ fontSize: 30 }}>R<span>OO</span>K</div>
        <h1 style={{ fontSize: 27, margin: '26px 0 10px', lineHeight: 1.25 }}>
          The fantasy stock market<br />for Formula 1
        </h1>
        <p className="muted" style={{ fontSize: 15, maxWidth: 400, margin: '0 auto', lineHeight: 1.55 }}>
          Build a portfolio of the teams you believe in. Prices are set by
          fans trading — not by bookmakers, not by us.
        </p>
      </div>

      {authError && (
        <div className="panel down" style={{ marginTop: 20, fontSize: 13.5, textAlign: 'center' }}>
          {authError}
        </div>
      )}

      <div style={{ maxWidth: 360, margin: '32px auto 0' }}>
        {showJoin ? <JoinForm inviteRequired={inviteRequired} magicLink={magicLink} /> : <WaitlistForm />}
        {inviteRequired && (
          <button
            onClick={() => setShowJoin(!showJoin)}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, marginTop: 12, cursor: 'pointer', width: '100%', textDecoration: 'underline' }}
          >
            {showJoin ? 'No invite? Join the waitlist' : 'Have an invite code?'}
          </button>
        )}
      </div>

      <h2 style={{ marginTop: 44 }}>The market, live</h2>
      <div className="panel" style={{ padding: '4px 16px' }}>
        {assets.slice(0, 5).map((a, i) => (
          <div key={a.symbol} className="row" style={{ padding: '11px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: a.color }} />
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>{a.name}</span>
            </span>
            <span className="row" style={{ gap: 12 }}>
              <span className="num" style={{ fontWeight: 600 }}>${a.price.toFixed(2)}</span>
              <span className={`num ${a.ret24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 13 }}>
                {a.ret24h >= 0 ? '▲' : '▼'} {Math.abs(a.ret24h * 100).toFixed(1)}%
              </span>
            </span>
          </div>
        ))}
      </div>

      <h2>How it works</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {[
          ['Equal stacks', 'Every player starts the season with the same $10,000 of play money. No top-ups, ever. The only way to have more is to trade better.'],
          ['Prices move on what fans do', 'Teams trade on an open curve. News breaks, conviction shifts, prices move — every change traceable to real trades.'],
          ['Reputation compounds', 'Your Rook Score is an Elo-style rating of being early and right. Climb from Rookie to Grandmaster. Seasons settle; your record is forever.'],
        ].map(([title, body]) => (
          <div key={title} className="panel">
            <strong>{title}</strong>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 5, lineHeight: 1.55 }}>{body}</p>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 26, borderColor: 'var(--accent)' }}>
        <strong>Not a sportsbook.</strong>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 5, lineHeight: 1.55 }}>
          No odds, no bet slips, no house edge, no cash. You hold positions
          and build a track record — you don&apos;t place wagers. Rook
          shouldn&apos;t be right. Rook should be fair.{' '}
          <a href="/fairness" style={{ textDecoration: 'underline' }}>How prices work →</a>
        </p>
      </div>

      <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: '30px 0 10px' }}>
        Play money only · rook.ai · <a href="/data" style={{ textDecoration: 'underline' }}>data licensing</a>
      </p>
    </div>
  );
}
