import { NextRequest, NextResponse } from 'next/server';
import { bookDepth } from '@rook/core';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await bookDepth(Number(id)));
}
