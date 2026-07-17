import { NextRequest } from 'next/server';
import { recentMoments } from '@rook/core';
import { dataEndpoint } from '../../../../../lib/dataApi';

/** Market-moment feed: significant moves with attribution (broadcast graphics). */
export async function GET(req: NextRequest) {
  return dataEndpoint(req, 'moments', async (seasonId) => {
    const rows = await recentMoments(seasonId, 50);
    return rows.map((m) => ({
      ts: m.ts,
      symbol: m.symbol,
      name: m.name,
      kind: m.kind,
      windowHours: m.window_hours,
      ret: Number(m.ret.toFixed(5)),
      price: Number(m.price.toFixed(4)),
      attribution: m.headline,
    }));
  });
}
