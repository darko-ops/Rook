import { NextRequest } from 'next/server';
import { db } from '@rook/db';
import { DataAuthError, priceHistory, sentimentSeries } from '@rook/core';
import { dataEndpoint } from '../../../../../../../lib/dataApi';

/** Per-asset price + sentiment/flow series (daily flow, hourly price). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  return dataEndpoint(req, `series:${symbol}`, async (seasonId, now) => {
    const [asset] = await db()`
      select id, symbol, name, kind from assets
      where season_id = ${seasonId} and symbol = ${symbol.toUpperCase()}
    `;
    if (!asset) throw new DataAuthError(404, 'unknown symbol');
    const days = Math.min(365, Number(req.nextUrl.searchParams.get('days') ?? 30));
    const since = new Date(now.getTime() - days * 86400e3);
    const [prices, sentiment] = await Promise.all([
      priceHistory(asset.id, since),
      sentimentSeries(asset.id, days, now),
    ]);
    return {
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      prices: prices.map((p) => ({ ts: p.ts, price: Number(p.price.toFixed(4)) })),
      sentiment: sentiment.map((s) => ({
        day: s.day,
        netFlow: Number(s.net_flow.toFixed(2)),
        volume: Number(s.volume.toFixed(2)),
        buyTradeShare: Number(s.buy_trade_share.toFixed(3)),
      })),
    };
  });
}
