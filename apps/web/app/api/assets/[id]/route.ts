import { NextRequest, NextResponse } from 'next/server';
import { currentSeason, measure, newsFeed, priceHistory } from '@rook/core';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const now = new Date();
  const season = await currentSeason(now);
  if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
  const assetId = Number(id);
  const since = new Date(season.starts_at);
  const [measurement, news, history] = await Promise.all([
    measure(assetId, season.id, now),
    newsFeed(season.id, now, assetId, 20),
    priceHistory(assetId, since),
  ]);
  return NextResponse.json({ measurement, news, history });
}
