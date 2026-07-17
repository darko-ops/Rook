import { NextRequest } from 'next/server';
import { listAssets } from '@rook/core';
import { dataEndpoint } from '../../../../../lib/dataApi';

/** Asset catalog: market prices, returns, volumes, real standings. */
export async function GET(req: NextRequest) {
  return dataEndpoint(req, 'assets', async (seasonId, now) => {
    const rows = await listAssets(seasonId, now);
    return rows.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      kind: a.kind,
      team: a.teamSymbol,
      price: Number(a.price.toFixed(4)),
      ret24h: Number(a.ret24h.toFixed(5)),
      ret7d: Number(a.ret7d.toFixed(5)),
      retSeason: Number(a.retSeason.toFixed(5)),
      volume24h: Number(a.volume24h.toFixed(2)),
      standing: a.standing,
    }));
  });
}
