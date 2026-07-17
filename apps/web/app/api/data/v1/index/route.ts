import { NextRequest } from 'next/server';
import { indexSeries } from '@rook/core';
import { dataEndpoint } from '../../../../../lib/dataApi';

/** Rook Index feed: cap-weighted league index, 100 = season open. */
export async function GET(req: NextRequest) {
  return dataEndpoint(req, 'index', async (seasonId, now) => {
    const days = Math.min(365, Number(req.nextUrl.searchParams.get('days') ?? 30));
    const rows = await indexSeries(seasonId, new Date(now.getTime() - days * 86400e3));
    return rows.map((r) => ({ ts: r.ts, value: Number(r.value.toFixed(3)) }));
  });
}
