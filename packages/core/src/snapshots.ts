import { db } from '@rook/db';

/**
 * Hourly price snapshot per open-season asset (charts, metrics, TWAP,
 * scoring). Timestamps are truncated to the hour and conflicts ignored, so
 * calling more often than hourly is harmless.
 */
export async function snapshotPrices(now: Date): Promise<number> {
  const sql = db();
  const hour = new Date(Math.floor(now.getTime() / 3600e3) * 3600e3);
  const dayAgo = new Date(now.getTime() - 86400e3);
  const rows = await sql`
    insert into price_points (asset_id, ts, price, supply, volume_24h)
    select a.id, ${hour}, a.p0 + a.m * a.supply, a.supply,
           coalesce((select sum(abs(t.cash_delta)) from trades t
                     where t.asset_id = a.id and t.ts > ${dayAgo}), 0)
    from assets a
    join seasons s on s.id = a.season_id
    where s.status = 'open'
    on conflict do nothing
    returning asset_id
  `;
  return rows.length;
}
