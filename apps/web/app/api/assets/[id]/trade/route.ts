import { NextRequest, NextResponse } from 'next/server';
import { executeUserTrade, track, TradeRejected } from '@rook/core';
import { sessionUser } from '../../../../../lib/session';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const side = body.side === 'sell' ? 'sell' : 'buy';
  const now = new Date();
  try {
    const trade = await executeUserTrade(user.id, {
      assetId: Number(id),
      side,
      qty: body.qty !== undefined ? Number(body.qty) : undefined,
      notional: body.notional !== undefined ? Number(body.notional) : undefined,
      now,
    });
    await track('trade', user.id, { assetId: trade.assetId, side, notional: Math.abs(trade.cashDelta) });
    return NextResponse.json(trade);
  } catch (e) {
    if (e instanceof TradeRejected) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
    }
    return NextResponse.json({ error: 'trade failed' }, { status: 500 });
  }
}
