import { NextResponse } from 'next/server';
import { currentSeason, leaderboard } from '@rook/core';

export async function GET() {
  const now = new Date();
  const season = await currentSeason(now);
  if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
  return NextResponse.json(await leaderboard(season.id, now));
}
