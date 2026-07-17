import { db } from '@rook/db';
import type { TransactionSql } from 'postgres';
import {
  applyTrade,
  qtyForCash,
  qtyForProceeds,
  routeOrder,
  spotPrice,
  type EngineConfig,
  type RouteResult,
  type RestingOrder,
  type Side,
} from '@rook/engine';
import { loadConfig } from './config.js';
import { TradeRejected, type ExecutedTrade, type TradeRequest } from './trade.js';

/**
 * v2 trade path: hybrid routing (§25). Marketable flow fills against the
 * book wherever the book beats the curve, with the AMM as permanent
 * backstop — graduation is a measurement, not a switch. Resting limit
 * orders escrow funds at placement (cash for bids, shares for asks) so the
 * book can never promise what an account doesn't hold.
 *
 * Ledger rules: only venue='curve' rows move supply/reserve; book fills
 * write one aggregate taker row plus one maker row per fill (maker=true,
 * excluded from taker rate limits). Every row still reconstructs balances.
 */

const MAX_OPEN_ORDERS_PER_ASSET = 10;

type Tx = TransactionSql;

async function loadBook(tx: Tx, assetId: number, oppositeOf: Side): Promise<RestingOrder[]> {
  const side = oppositeOf === 'buy' ? 'sell' : 'buy';
  const rows = await tx`
    select id, user_id, side, limit_price, remaining from orders
    where asset_id = ${assetId} and status = 'open' and side = ${side}
    order by id for update
  `;
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, side: r.side, limitPrice: r.limit_price,
    remaining: r.remaining, seq: r.id,
  }));
}

/**
 * Apply a routed execution inside an open transaction: curve part, book
 * fills (both legs), balances, holdings, avg costs, audit rows.
 * Returns the taker's totals.
 */
async function settle(
  tx: Tx,
  cfg: EngineConfig,
  asset: { id: number; season_id: number; supply: number; reserve: number },
  takerId: number,
  side: Side,
  route: RouteResult,
  now: Date,
  copiedFrom: number | null,
): Promise<{ qty: number; cashDelta: number; priceBefore: number; priceAfter: number; tradeId: number }> {
  const priceBefore = spotPrice(cfg, asset.supply);
  let takerQty = 0;
  let takerCash = 0; // negative = taker pays
  let lastTradeId = 0;

  // --- curve leg (the only thing that moves supply/reserve) ---
  if (route.curveQty > 1e-9) {
    const { asset: next, result } = applyTrade(
      cfg,
      { id: String(asset.id), supply: asset.supply, reserve: asset.reserve },
      side,
      route.curveQty,
      { skipSizeCap: true }, // cap was enforced on the routed total
    );
    await tx`update assets set supply = ${next.supply}, reserve = ${next.reserve} where id = ${asset.id}`;
    asset.supply = next.supply;
    asset.reserve = next.reserve;
    const [row] = await tx`
      insert into trades (asset_id, actor, user_id, side, qty, cash_delta, price_before, price_after, ts, venue, copied_from)
      values (${asset.id}, 'user', ${takerId}, ${side}, ${route.curveQty}, ${result.cashDelta},
              ${result.priceBefore}, ${result.priceAfter}, ${now}, 'curve', ${copiedFrom})
      returning id
    `;
    lastTradeId = Number(row!.id);
    takerQty += route.curveQty;
    takerCash += result.cashDelta;
  }

  // --- book fills: maker legs + aggregate taker leg ---
  if (route.fills.length > 0) {
    let fillQty = 0;
    let fillCash = 0;
    for (const f of route.fills) {
      const notional = f.qty * f.price;
      fillQty += f.qty;
      fillCash += notional;
      const [order] = await tx`
        update orders set remaining = remaining - ${f.qty},
          status = case when remaining - ${f.qty} <= 1e-9 then 'filled' else 'open' end
        where id = ${f.makerOrderId} returning side
      `;
      // maker's escrow converts: ask-maker escrowed shares → receives cash;
      // bid-maker escrowed cash at limit → receives shares
      if (order!.side === 'sell') {
        await tx`update balances set cash = cash + ${notional}
          where user_id = ${f.makerUserId} and season_id = ${asset.season_id}`;
      } else {
        const [h] = await tx`
          select qty, avg_cost from holdings where user_id = ${f.makerUserId} and asset_id = ${asset.id}
        `;
        const held = h?.qty ?? 0;
        const newAvg = (held * (h?.avg_cost ?? 0) + notional) / (held + f.qty);
        await tx`
          insert into holdings (user_id, asset_id, qty, avg_cost)
          values (${f.makerUserId}, ${asset.id}, ${f.qty}, ${f.price})
          on conflict (user_id, asset_id) do update set qty = holdings.qty + ${f.qty}, avg_cost = ${newAvg}
        `;
      }
      await tx`
        insert into trades (asset_id, actor, user_id, side, qty, cash_delta, price_before, price_after, ts, venue, maker)
        values (${asset.id}, 'user', ${f.makerUserId}, ${order!.side}, ${f.qty},
                ${order!.side === 'sell' ? notional : -notional},
                ${f.price}, ${f.price}, ${now}, 'book', true)
      `;
    }
    const vwap = fillCash / fillQty;
    const [row] = await tx`
      insert into trades (asset_id, actor, user_id, side, qty, cash_delta, price_before, price_after, ts, venue, copied_from)
      values (${asset.id}, 'user', ${takerId}, ${side}, ${fillQty},
              ${side === 'buy' ? -fillCash : fillCash}, ${vwap}, ${vwap}, ${now}, 'book', ${copiedFrom})
      returning id
    `;
    lastTradeId = Number(row!.id);
    takerQty += fillQty;
    takerCash += side === 'buy' ? -fillCash : fillCash;
  }

  // --- taker balance + holding ---
  if (takerQty > 1e-9) {
    await tx`update balances set cash = cash + ${takerCash}
      where user_id = ${takerId} and season_id = ${asset.season_id}`;
    const [h] = await tx`
      select qty, avg_cost from holdings where user_id = ${takerId} and asset_id = ${asset.id}
    `;
    const held = h?.qty ?? 0;
    const newQty = side === 'buy' ? held + takerQty : Math.max(0, held - takerQty);
    const newAvg =
      side === 'buy' ? (held * (h?.avg_cost ?? 0) + -takerCash) / (held + takerQty) : (h?.avg_cost ?? 0);
    await tx`
      insert into holdings (user_id, asset_id, qty, avg_cost)
      values (${takerId}, ${asset.id}, ${newQty}, ${newAvg})
      on conflict (user_id, asset_id) do update set qty = ${newQty}, avg_cost = ${newAvg}
    `;
  }

  return {
    qty: takerQty,
    cashDelta: takerCash,
    priceBefore,
    priceAfter: spotPrice(cfg, asset.supply),
    tradeId: lastTradeId,
  };
}

async function loadAssetForUpdate(tx: Tx, assetId: number): Promise<{ id: number; season_id: number; supply: number; reserve: number; p0: number; m: number; season_status: string }> {
  await tx`select pg_advisory_xact_lock(${assetId})`;
  const [asset] = await tx`
    select a.*, s.status as season_status from assets a
    join seasons s on s.id = a.season_id where a.id = ${assetId}
  `;
  if (!asset) throw new TradeRejected('bad-input', 'unknown asset');
  if (asset.season_status !== 'open') throw new TradeRejected('season-closed', 'season is not open');
  return asset as never;
}

async function checkRateLimit(tx: Tx, cfg: EngineConfig, userId: number, assetId: number, now: Date) {
  const dayAgo = new Date(now.getTime() - 86400e3);
  const [{ n }] = (await tx`
    select count(*)::int as n from trades
    where user_id = ${userId} and asset_id = ${assetId} and ts > ${dayAgo} and not maker
  `) as unknown as [{ n: number }];
  if (n >= cfg.trading.maxTradesPerAssetPerDay) {
    throw new TradeRejected('rate-limit', 'per-asset daily trade limit reached');
  }
}

/** Market order through hybrid routing (the §22 /trade path, v2 semantics). */
export async function executeUserTrade(
  userId: number,
  req: TradeRequest & { copiedFrom?: number },
): Promise<ExecutedTrade> {
  if ((req.qty === undefined) === (req.notional === undefined)) {
    throw new TradeRejected('bad-input', 'provide exactly one of qty / notional');
  }
  const cfg = await loadConfig(req.now);
  const sql = db();
  return sql.begin(async (tx) => {
    const asset = await loadAssetForUpdate(tx, req.assetId);
    const curveCfg: EngineConfig = { ...cfg, curve: { p0: asset.p0, m: asset.m } };

    let qty: number;
    if (req.qty !== undefined) {
      if (!(req.qty > 0)) throw new TradeRejected('bad-input', 'qty must be positive');
      qty = req.qty;
    } else {
      if (!(req.notional! > 0)) throw new TradeRejected('bad-input', 'notional must be positive');
      qty =
        req.side === 'buy'
          ? qtyForCash(curveCfg, asset.supply, req.notional!)
          : qtyForProceeds(curveCfg, asset.supply, req.notional!);
    }
    if (!(qty > 0)) throw new TradeRejected('bad-input', 'trade resolves to zero qty');

    const [bal] = await tx`
      select cash from balances where user_id = ${userId} and season_id = ${asset.season_id} for update
    `;
    if (!bal) throw new TradeRejected('bad-input', 'user has not joined this season');
    const [h] = await tx`
      select qty from holdings where user_id = ${userId} and asset_id = ${req.assetId} for update
    `;
    await checkRateLimit(tx, cfg, userId, req.assetId, req.now);
    if (req.side === 'sell' && qty > (h?.qty ?? 0) + 1e-9) {
      throw new TradeRejected('insufficient-holdings', 'not enough shares');
    }

    const book = await loadBook(tx, req.assetId, req.side);
    const route = routeOrder(curveCfg, req.side, qty, userId, book, asset.supply);
    const totalNotional =
      route.curveCash + route.fills.reduce((s, f) => s + f.qty * f.price, 0);
    if (totalNotional > cfg.trading.maxTradeNotional * 1.001) {
      throw new TradeRejected('size-cap', `notional ${totalNotional.toFixed(2)} exceeds cap`);
    }
    if (req.side === 'buy' && totalNotional > bal.cash + 1e-9) {
      throw new TradeRejected('insufficient-cash', 'not enough cash');
    }

    const settled = await settle(
      tx, curveCfg, asset, userId, req.side, route, req.now, req.copiedFrom ?? null,
    );
    return {
      tradeId: settled.tradeId,
      assetId: req.assetId,
      side: req.side,
      qty: settled.qty,
      cashDelta: settled.cashDelta,
      priceBefore: settled.priceBefore,
      priceAfter: settled.priceAfter,
    };
  }) as Promise<ExecutedTrade>;
}

export interface PlacedOrder {
  orderId: number | null; // null when fully filled on entry
  executedQty: number;
  restingQty: number;
  cashDelta: number;
}

/** Place a limit order: crossing part executes immediately, rest rests with escrow. */
export async function placeLimitOrder(
  userId: number,
  req: { assetId: number; side: Side; limitPrice: number; qty: number; now: Date },
): Promise<PlacedOrder> {
  if (!(req.qty > 0) || !(req.limitPrice > 0)) {
    throw new TradeRejected('bad-input', 'qty and limit price must be positive');
  }
  const cfg = await loadConfig(req.now);
  if (req.qty * req.limitPrice > cfg.trading.maxTradeNotional) {
    throw new TradeRejected('size-cap', 'order notional exceeds per-trade cap');
  }
  const sql = db();
  return sql.begin(async (tx) => {
    const asset = await loadAssetForUpdate(tx, req.assetId);
    const curveCfg: EngineConfig = { ...cfg, curve: { p0: asset.p0, m: asset.m } };

    const [{ open }] = (await tx`
      select count(*)::int as open from orders
      where user_id = ${userId} and asset_id = ${req.assetId} and status = 'open'
    `) as unknown as [{ open: number }];
    if (open >= MAX_OPEN_ORDERS_PER_ASSET) {
      throw new TradeRejected('rate-limit', 'too many open orders on this asset');
    }

    const [bal] = await tx`
      select cash from balances where user_id = ${userId} and season_id = ${asset.season_id} for update
    `;
    if (!bal) throw new TradeRejected('bad-input', 'user has not joined this season');
    const [h] = await tx`
      select qty from holdings where user_id = ${userId} and asset_id = ${req.assetId} for update
    `;
    if (req.side === 'sell' && req.qty > (h?.qty ?? 0) + 1e-9) {
      throw new TradeRejected('insufficient-holdings', 'not enough shares');
    }
    await checkRateLimit(tx, cfg, userId, req.assetId, req.now);

    const book = await loadBook(tx, req.assetId, req.side);
    const route = routeOrder(curveCfg, req.side, req.qty, userId, book, asset.supply, {
      limitPrice: req.limitPrice,
    });
    const execNotional = route.curveCash + route.fills.reduce((s, f) => s + f.qty * f.price, 0);
    const restingEscrow = req.side === 'buy' ? route.unfilled * req.limitPrice : 0;
    if (req.side === 'buy' && execNotional + restingEscrow > bal.cash + 1e-9) {
      throw new TradeRejected('insufficient-cash', 'not enough cash to cover order');
    }

    const settled = await settle(
      tx, curveCfg, asset, userId, req.side, route, req.now, null,
    );

    let orderId: number | null = null;
    if (route.unfilled > 1e-9) {
      // escrow: bids hold cash at the limit, asks hold the shares
      if (req.side === 'buy') {
        await tx`update balances set cash = cash - ${restingEscrow}
          where user_id = ${userId} and season_id = ${asset.season_id}`;
      } else {
        await tx`update holdings set qty = qty - ${route.unfilled}
          where user_id = ${userId} and asset_id = ${req.assetId}`;
      }
      const [row] = await tx`
        insert into orders (asset_id, user_id, side, limit_price, qty, remaining)
        values (${req.assetId}, ${userId}, ${req.side}, ${req.limitPrice}, ${req.qty}, ${route.unfilled})
        returning id
      `;
      orderId = row!.id;
    }
    return {
      orderId,
      executedQty: settled.qty,
      restingQty: route.unfilled,
      cashDelta: settled.cashDelta,
    };
  }) as Promise<PlacedOrder>;
}

export async function cancelOrder(userId: number, orderId: number, now: Date): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    const [order] = await tx`
      select o.*, a.season_id from orders o join assets a on a.id = o.asset_id
      where o.id = ${orderId} for update of o
    `;
    if (!order || order.user_id !== userId) throw new TradeRejected('bad-input', 'unknown order');
    if (order.status !== 'open') throw new TradeRejected('bad-input', 'order is not open');
    await tx`select pg_advisory_xact_lock(${order.asset_id})`;
    if (order.side === 'buy') {
      await tx`update balances set cash = cash + ${order.remaining * order.limit_price}
        where user_id = ${userId} and season_id = ${order.season_id}`;
    } else {
      await tx`update holdings set qty = qty + ${order.remaining}
        where user_id = ${userId} and asset_id = ${order.asset_id}`;
    }
    await tx`update orders set status = 'cancelled' where id = ${orderId}`;
    void now;
  });
}

export interface BookLevel {
  price: number;
  qty: number;
}

export async function bookDepth(assetId: number): Promise<{ bids: BookLevel[]; asks: BookLevel[] }> {
  const rows = await db()`
    select side, limit_price, sum(remaining) as qty from orders
    where asset_id = ${assetId} and status = 'open'
    group by side, limit_price
  `;
  const bids = rows
    .filter((r) => r.side === 'buy')
    .map((r) => ({ price: r.limit_price as number, qty: r.qty as number }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);
  const asks = rows
    .filter((r) => r.side === 'sell')
    .map((r) => ({ price: r.limit_price as number, qty: r.qty as number }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);
  return { bids, asks };
}

export async function openOrders(userId: number) {
  return db()`
    select o.id, o.side, o.limit_price, o.qty, o.remaining, o.created_at, a.symbol, a.name, a.color
    from orders o join assets a on a.id = o.asset_id
    where o.user_id = ${userId} and o.status = 'open'
    order by o.created_at desc
  `;
}
