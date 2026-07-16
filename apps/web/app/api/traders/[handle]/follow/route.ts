import { NextRequest, NextResponse } from 'next/server';
import { follow, track, unfollow } from '@rook/core';
import { sessionUser } from '../../../../../lib/session';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { handle } = await ctx.params;
  await follow(user.id, handle);
  await track('follow', user.id, { handle });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { handle } = await ctx.params;
  await unfollow(user.id, handle);
  return NextResponse.json({ ok: true });
}
