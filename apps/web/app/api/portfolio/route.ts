import { NextResponse } from 'next/server';
import { currentSeason, portfolio } from '@rook/core';
import { sessionUser } from '../../../lib/session';

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const now = new Date();
  const season = await currentSeason(now);
  if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
  return NextResponse.json(await portfolio(user.id, season.id, now));
}
