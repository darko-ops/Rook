import { NextRequest, NextResponse } from 'next/server';
import { quote, TradeRejected } from '@rook/core';

/** Curve-quoted cost/proceeds shown on the trade sheet before confirm (§23.2). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const side = req.nextUrl.searchParams.get('side') === 'sell' ? 'sell' : 'buy';
  const notional = Number(req.nextUrl.searchParams.get('notional') ?? 0);
  try {
    const q = await quote(Number(id), side, notional, new Date());
    return NextResponse.json(q);
  } catch (e) {
    if (e instanceof TradeRejected) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: 'quote failed' }, { status: 500 });
  }
}
