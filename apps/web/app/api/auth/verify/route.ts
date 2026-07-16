import { NextRequest, NextResponse } from 'next/server';
import { currentSeason, joinSeason, track, verifyMagicLink } from '@rook/core';
import { SESSION_COOKIE } from '../../../../lib/session';

export async function GET(req: NextRequest) {
  const now = new Date();
  const token = req.nextUrl.searchParams.get('token') ?? '';
  try {
    const session = await verifyMagicLink(token, now);
    const season = await currentSeason(now);
    if (season) await joinSeason(session.userId, season.id, now);
    await track('login', session.userId, { handle: session.handle, via: 'magic-link' });
    const res = NextResponse.redirect(new URL('/', req.nextUrl.origin));
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 90 * 86400,
      path: '/',
    });
    return res;
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : 'sign-in failed');
    return NextResponse.redirect(new URL(`/?auth_error=${msg}`, req.nextUrl.origin));
  }
}
