import { NextRequest, NextResponse } from 'next/server';
import { setFlair } from '@rook/core';
import { sessionUser } from '../../../lib/session';

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    await setFlair(user.id, body.flair ? String(body.flair) : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 422 });
  }
}
