import { NextResponse } from 'next/server';
import { mintMyInvite, myInvites, track } from '@rook/core';
import { sessionUser } from '../../../lib/session';

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  return NextResponse.json(await myInvites(user.id));
}

export async function POST() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  try {
    const code = await mintMyInvite(user.id);
    await track('invite:mint', user.id);
    return NextResponse.json({ code });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 422 });
  }
}
