import { NextRequest, NextResponse } from 'next/server';
import { priceCsv, track } from '@rook/core';
import { sessionUser } from '../../../../../lib/session';

/** Pro-only data export (§25 Opening Book). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (user.plan !== 'pro') {
    return NextResponse.json({ error: 'Opening Book (pro) required', code: 'pro-required' }, { status: 402 });
  }
  const { id } = await ctx.params;
  const csv = await priceCsv(Number(id));
  await track('export:csv', user.id, { assetId: Number(id) });
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv',
      'content-disposition': `attachment; filename="rook-asset-${id}.csv"`,
    },
  });
}
