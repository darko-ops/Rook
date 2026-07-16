import { NextRequest, NextResponse } from 'next/server';
import {
  currentSeason,
  InviteRequired,
  joinSeason,
  login,
  magicLinkEnabled,
  requestMagicLink,
  track,
} from '@rook/core';
import { SESSION_COOKIE } from '../../../../lib/session';

export async function POST(req: NextRequest) {
  const now = new Date();
  const body = await req.json().catch(() => ({}));
  const handle = String(body.handle ?? '');
  const invite = body.invite ? String(body.invite) : undefined;
  try {
    if (await magicLinkEnabled(now)) {
      const email = String(body.email ?? '');
      if (!email) return NextResponse.json({ error: 'email required', code: 'email-required' }, { status: 400 });
      await requestMagicLink(handle, email, req.nextUrl.origin, now, invite);
      return NextResponse.json({ sent: true });
    }
    const session = await login(handle, now, invite);
    const season = await currentSeason(now);
    if (season) await joinSeason(session.userId, season.id, now);
    await track('login', session.userId, { handle: session.handle });
    const res = NextResponse.json({ handle: session.handle });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 90 * 86400,
      path: '/',
    });
    return res;
  } catch (e) {
    if (e instanceof InviteRequired) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'login failed' }, { status: 400 });
  }
}
