import { db } from '@rook/db';
import { HouseMover, type NewsEvent } from '@rook/engine';
import { loadConfig } from './config.js';
import { executeHouseTrade } from './trade.js';

const HOUR = 3600e3;
const toTicks = (d: Date): number => d.getTime() / HOUR; // engine ticks = hours

/**
 * House mover tick: consume unprocessed classified news events and execute
 * small, capped, flagged synthetic trades in the event's direction (§13.2).
 * Stateless — the trailing-window flow state is rebuilt from the trade log,
 * so restarts can't lose cap accounting. Every decision (executed or not)
 * lands in mover_log: the mover's public conscience.
 */
export async function moverTick(now: Date): Promise<{ executed: number; skipped: number }> {
  const sql = db();
  const cfg = await loadConfig(now);
  const events = await sql`
    select n.*, a.symbol, a.supply, a.reserve, a.p0, a.m
    from news_events n
    join assets a on a.id = n.asset_id
    join seasons s on s.id = a.season_id and s.status = 'open'
    where not n.processed_by_mover and n.ts <= ${now}
      and n.sign is not null and n.magnitude is not null
    order by n.ts
  `;
  let executed = 0;
  let skipped = 0;

  for (const ev of events) {
    // rebuild trailing-window flow for this asset from the audit trail
    const windowStart = new Date(now.getTime() - cfg.mover.windowTicks * HOUR);
    const flows = await sql`
      select actor, ts, abs(cash_delta) as notional, abs(price_after - price_before) as impact
      from trades where asset_id = ${ev.asset_id} and ts > ${windowStart}
    `;
    const mover = new HouseMover({ ...cfg, curve: { p0: ev.p0, m: ev.m } });
    for (const f of flows) {
      if (f.actor === 'house') mover.recordHouseTrade(ev.symbol, toTicks(f.ts), f.notional, f.impact);
      else mover.recordUserTrade(ev.symbol, toTicks(f.ts), f.notional, f.impact);
    }

    const engineEvent: NewsEvent = {
      id: String(ev.id),
      ts: toTicks(now), // decide with current window state at execution time
      assetId: ev.symbol,
      sign: ev.sign,
      magnitude: ev.magnitude,
    };
    const decision = mover.decide(engineEvent, {
      id: ev.symbol,
      supply: ev.supply,
      reserve: ev.reserve,
    });

    let tradeId: number | null = null;
    if (decision.execute) {
      const trade = await executeHouseTrade(cfg, {
        assetId: ev.asset_id,
        side: ev.sign > 0 ? 'buy' : 'sell',
        qty: decision.qty,
        now,
      });
      tradeId = trade.tradeId;
      executed++;
    } else {
      skipped++;
    }
    await sql`
      insert into mover_log (news_event_id, asset_id, ts, executed, reason, qty, notional, delta, trade_id)
      values (${ev.id}, ${ev.asset_id}, ${now}, ${decision.execute}, ${decision.reason},
              ${decision.qty}, ${decision.notional}, ${decision.delta}, ${tradeId})
    `;
    await sql`update news_events set processed_by_mover = true where id = ${ev.id}`;
  }
  return { executed, skipped };
}
