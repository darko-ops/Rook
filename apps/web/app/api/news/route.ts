import { NextRequest, NextResponse } from 'next/server';
import { currentSeason, newsFeed } from '@rook/core';

export async function GET(req: NextRequest) {
  const now = new Date();
  const season = await currentSeason(now);
  if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
  const asset = req.nextUrl.searchParams.get('asset');
  return NextResponse.json(
    await newsFeed(season.id, now, asset ? Number(asset) : undefined),
  );
}
