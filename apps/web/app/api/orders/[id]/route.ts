import { NextRequest, NextResponse } from 'next/server';
import { cancelOrder, TradeRejected } from '@rook/core';
import { sessionUser } from '../../../../lib/session';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await cancelOrder(user.id, Number(id), new Date());
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TradeRejected) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return NextResponse.json({ error: 'cancel failed' }, { status: 500 });
  }
}
