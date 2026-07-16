import { NextRequest, NextResponse } from 'next/server';
import { currentSeason, InviteRequired, joinSeason, login, track } from '@rook/core';
import { SESSION_COOKIE } from '../../../../lib/session';

export async function POST(req: NextRequest) {
  const now = new Date();
  const body = await req.json().catch(() => ({}));
  const handle = String(body.handle ?? '');
  try {
    const session = await login(handle, now, body.invite ? String(body.invite) : undefined);
    const season = await currentSeason(now);
    if (season) await joinSeason(session.userId, season.id, now); // equal stack on join
    await track('login', session.userId, { handle: session.handle });
    const res = NextResponse.json({ handle: session.handle });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
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
