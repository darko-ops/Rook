import { db } from '@rook/db';
import {
  applyTrade,
  qtyForCash,
  qtyForProceeds,
  spotPrice,
  type EngineConfig,
  type Side,
} from '@rook/engine';
import { loadConfig } from './config.js';

export class TradeRejected extends Error {
  constructor(
    readonly code:
      | 'size-cap'
      | 'rate-limit'
      | 'insufficient-cash'
      | 'insufficient-holdings'
      | 'season-closed'
      | 'bad-input',
    message: string,
  ) {
    super(message);
  }
}

export interface ExecutedTrade {
  tradeId: number;
  assetId: number;
  side: Side;
  qty: number;
  cashDelta: number;
  priceBefore: number;
  priceAfter: number;
}

export interface TradeRequest {
  assetId: number;
  side: Side;
  /** exactly one of qty / notional */
  qty?: number;
  notional?: number;
  now: Date;
}

/**
 * The trade path (§22): validate → per-asset lock → curve math → atomic
 * writes to trades/holdings/balances → caller emits price point.
 *
 * The per-asset advisory lock makes this a single-writer service per asset:
 * an AMM is a shared counter; correctness beats cleverness.
 */
export async function executeUserTrade(userId: number, req: TradeRequest): Promise<ExecutedTrade> {
  const cfg = await loadConfig(req.now);
  return execute(cfg, { actor: 'user', userId }, req, {});
}

/** House mover trades follow the identical path, flagged actor='house'. */
export async function executeHouseTrade(
  cfg: EngineConfig,
  req: TradeRequest,
): Promise<ExecutedTrade> {
  return execute(cfg, { actor: 'house' }, req, { skipSizeCap: true, skipRateLimit: true });
}

async function execute(
  cfg: EngineConfig,
  who: { actor: 'user' | 'house'; userId?: number },
  req: TradeRequest,
  opts: { skipSizeCap?: boolean; skipRateLimit?: boolean },
): Promise<ExecutedTrade> {
  if ((req.qty === undefined) === (req.notional === undefined)) {
    throw new TradeRejected('bad-input', 'provide exactly one of qty / notional');
  }
  if (req.qty !== undefined && !(req.qty > 0)) {
    throw new TradeRejected('bad-input', 'qty must be positive');
  }
  if (req.notional !== undefined && !(req.notional > 0)) {
    throw new TradeRejected('bad-input', 'notional must be positive');
  }

  const sql = db();
  return sql.begin(async (tx) => {
    // single writer per asset
    await tx`select pg_advisory_xact_lock(${req.assetId})`;

    const [asset] = await tx`
      select a.*, s.status as season_status from assets a
      join seasons s on s.id = a.season_id
      where a.id = ${req.assetId}
    `;
    if (!asset) throw new TradeRejected('bad-input', 'unknown asset');
    if (asset.season_status !== 'open') throw new TradeRejected('season-closed', 'season is not open');

    const curveCfg: EngineConfig = { ...cfg, curve: { p0: asset.p0, m: asset.m } };
    const supply: number = asset.supply;

    // resolve qty from notional if needed
    let qty: number;
    if (req.qty !== undefined) {
      qty = req.qty;
    } else if (req.side === 'buy') {
      qty = qtyForCash(curveCfg, supply, req.notional!);
    } else {
      qty = qtyForProceeds(curveCfg, supply, req.notional!);
    }
    if (!(qty > 0)) throw new TradeRejected('bad-input', 'trade resolves to zero qty');

    // user-side validation
    let cash = 0;
    let held = 0;
    let avgCost = 0;
    if (who.actor === 'user') {
      const [bal] = await tx`
        select cash from balances
        where user_id = ${who.userId!} and season_id = ${asset.season_id} for update
      `;
      if (!bal) throw new TradeRejected('bad-input', 'user has not joined this season');
      cash = bal.cash;
      const [h] = await tx`
        select qty, avg_cost from holdings
        where user_id = ${who.userId!} and asset_id = ${req.assetId} for update
      `;
      held = h?.qty ?? 0;
      avgCost = h?.avg_cost ?? 0;

      if (!opts.skipRateLimit) {
        const dayAgo = new Date(req.now.getTime() - 86400e3);
        const [{ n }] = (await tx`
          select count(*)::int as n from trades
          where user_id = ${who.userId!} and asset_id = ${req.assetId} and ts > ${dayAgo}
        `) as unknown as [{ n: number }];
        if (n >= cfg.trading.maxTradesPerAssetPerDay) {
          throw new TradeRejected('rate-limit', 'per-asset daily trade limit reached');
        }
      }
      if (req.side === 'sell' && qty > held + 1e-9) {
        throw new TradeRejected('insufficient-holdings', 'not enough shares');
      }
    } else if (req.side === 'sell' && qty > supply) {
      qty = supply; // house sells capped at circulating supply (Phase 0 note)
      if (qty <= 0) throw new TradeRejected('bad-input', 'no supply to sell against');
    }

    // curve math (engine is the single source of truth)
    let result;
    try {
      result = applyTrade(
        curveCfg,
        { id: String(req.assetId), supply, reserve: asset.reserve },
        req.side,
        qty,
        { skipSizeCap: opts.skipSizeCap },
      );
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'size-cap') {
        throw new TradeRejected('size-cap', e.message);
      }
      throw new TradeRejected('bad-input', e instanceof Error ? e.message : String(e));
    }
    const { cashDelta, priceBefore, priceAfter } = result.result;

    if (who.actor === 'user' && req.side === 'buy' && -cashDelta > cash + 1e-9) {
      throw new TradeRejected('insufficient-cash', 'not enough cash');
    }

    // atomic writes
    await tx`update assets set supply = ${result.asset.supply}, reserve = ${result.asset.reserve}
      where id = ${req.assetId}`;
    if (who.actor === 'user') {
      await tx`update balances set cash = cash + ${cashDelta}
        where user_id = ${who.userId!} and season_id = ${asset.season_id}`;
      const newQty = req.side === 'buy' ? held + qty : held - qty;
      const newAvg =
        req.side === 'buy'
          ? (held * avgCost + -cashDelta) / (held + qty)
          : avgCost; // sells realize P&L; basis unchanged
      await tx`
        insert into holdings (user_id, asset_id, qty, avg_cost)
        values (${who.userId!}, ${req.assetId}, ${Math.max(0, newQty)}, ${newAvg})
        on conflict (user_id, asset_id)
        do update set qty = ${Math.max(0, newQty)}, avg_cost = ${newAvg}
      `;
    }
    const [trade] = await tx`
      insert into trades (asset_id, actor, user_id, side, qty, cash_delta, price_before, price_after, ts)
      values (${req.assetId}, ${who.actor}, ${who.userId ?? null}, ${req.side}, ${qty},
              ${cashDelta}, ${priceBefore}, ${priceAfter}, ${req.now})
      returning id
    `;
    return {
      tradeId: trade!.id as number,
      assetId: req.assetId,
      side: req.side,
      qty,
      cashDelta,
      priceBefore,
      priceAfter,
    };
  }) as Promise<ExecutedTrade>;
}

/** Quote a trade without executing (the trade sheet shows this pre-confirm). */
export async function quote(
  assetId: number,
  side: Side,
  notional: number,
  now: Date,
): Promise<{ qty: number; price: number; effectivePrice: number }> {
  const cfg = await loadConfig(now);
  const [asset] = await db()`select p0, m, supply from assets where id = ${assetId}`;
  if (!asset) throw new TradeRejected('bad-input', 'unknown asset');
  const curveCfg: EngineConfig = { ...cfg, curve: { p0: asset.p0, m: asset.m } };
  const qty =
    side === 'buy'
      ? qtyForCash(curveCfg, asset.supply, notional)
      : qtyForProceeds(curveCfg, asset.supply, notional);
  const price = spotPrice(curveCfg, asset.supply);
  return { qty, price, effectivePrice: qty > 0 ? notional / qty : price };
}
