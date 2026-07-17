import { NextRequest, NextResponse } from 'next/server';
import { authorizeDataRequest, currentSeason, DataAuthError } from '@rook/core';

/**
 * Shared wrapper for the licensed data API (§27): key auth via x-rook-key,
 * per-key daily limits, usage logged. Errors are JSON, never HTML.
 */
export async function dataEndpoint(
  req: NextRequest,
  endpoint: string,
  handler: (seasonId: number, now: Date) => Promise<unknown>,
): Promise<NextResponse> {
  const now = new Date();
  try {
    await authorizeDataRequest(req.headers.get('x-rook-key'), endpoint);
    const season = await currentSeason(now);
    if (!season) return NextResponse.json({ error: 'no open season' }, { status: 404 });
    const data = await handler(season.id, now);
    return NextResponse.json({
      league: season.league,
      season: season.name,
      asOf: now.toISOString(),
      data,
    });
  } catch (e) {
    if (e instanceof DataAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
