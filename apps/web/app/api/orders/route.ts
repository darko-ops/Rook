import { NextRequest, NextResponse } from 'next/server';
import { openOrders, placeLimitOrder, track, TradeRejected } from '@rook/core';
import { sessionUser } from '../../../lib/session';

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  return NextResponse.json(await openOrders(user.id));
}

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const placed = await placeLimitOrder(user.id, {
      assetId: Number(body.assetId),
      side: body.side === 'sell' ? 'sell' : 'buy',
      limitPrice: Number(body.limitPrice),
      qty: Number(body.qty),
      now: new Date(),
    });
    await track('order:place', user.id, { assetId: Number(body.assetId) });
    return NextResponse.json(placed);
  } catch (e) {
    if (e instanceof TradeRejected) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
    }
    return NextResponse.json({ error: 'order failed' }, { status: 500 });
  }
}
