import { NextRequest, NextResponse } from 'next/server';
import { currentSeason, listAssets } from '@rook/core';

export async function GET(req: NextRequest) {
  const now = new Date();
  const season = await currentSeason(now);
  if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
  const kindParam = req.nextUrl.searchParams.get('kind');
  const kind = kindParam === 'team' || kindParam === 'driver' ? kindParam : undefined;
  return NextResponse.json(await listAssets(season.id, now, kind));
}
