import { NextRequest, NextResponse } from 'next/server';
import { currentSeason, traderProfile } from '@rook/core';
import { sessionUser } from '../../../../lib/session';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const now = new Date();
  const season = await currentSeason(now);
  if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
  const viewer = await sessionUser();
  const profile = await traderProfile(handle, season.id, now, viewer?.id ?? null);
  if (!profile) return NextResponse.json({ error: 'unknown trader' }, { status: 404 });
  return NextResponse.json(profile);
}
