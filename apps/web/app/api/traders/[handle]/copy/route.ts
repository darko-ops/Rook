import { NextRequest, NextResponse } from 'next/server';
import { disableCopy, enableCopy, track } from '@rook/core';
import { sessionUser } from '../../../../../lib/session';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { handle } = await ctx.params;
  try {
    await enableCopy(user.id, handle);
    await track('copy:enable', user.id, { handle });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 422 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { handle } = await ctx.params;
  await disableCopy(user.id, handle);
  return NextResponse.json({ ok: true });
}
