import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, migrate } from '@rook/db';
import {
  cancelOrder,
  copyTick,
  enableCopy,
  executeUserTrade,
  joinSeason,
  login,
  openSeason,
  placeLimitOrder,
} from '@rook/core';

const NOW = new Date('2026-03-02T12:00:00Z');
let seasonId: number;
let alice: number;
let bob: number;
let carol: number;
let assetId: number;

const cash = async (userId: number): Promise<number> => {
  const [b] = await db()`select cash from balances where user_id = ${userId} and season_id = ${seasonId}`;
  return b!.cash;
};
const held = async (userId: number): Promise<number> => {
  const [h] = await db()`select qty from holdings where user_id = ${userId} and asset_id = ${assetId}`;
  return h?.qty ?? 0;
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    const { default: postgres } = await import('postgres');
    const admin = postgres('postgres://rook:rook@localhost:5455/postgres');
    await admin`create database rook_test`.catch(() => undefined);
    await admin.end();
    process.env.DATABASE_URL = 'postgres://rook:rook@localhost:5455/rook_test';
  }
  await migrate();
  await db().unsafe(`
    truncate users, sessions, seasons, assets, balances, holdings, trades,
      price_points, news_events, mover_log, scores, score_windows, follows,
      config, events, orders, copy_follows, copy_cursor restart identity cascade
  `);
  seasonId = await openSeason(
    'f1-test2', 'Book Season',
    [{ symbol: 'AAA', name: 'Team A', color: '#fff' }],
    new Date('2026-03-01T00:00:00Z'),
    new Date('2026-07-01T00:00:00Z'),
  );
  alice = (await login('alice', NOW)).userId;
  bob = (await login('bob', NOW)).userId;
  carol = (await login('carol', NOW)).userId;
  for (const u of [alice, bob, carol]) await joinSeason(u, seasonId, NOW);
  const [a] = await db()`select id from assets where season_id = ${seasonId}`;
  assetId = a!.id;
  // give alice inventory via the curve (price rises above p0)
  await executeUserTrade(alice, { assetId, side: 'buy', notional: 900, now: NOW });
});

afterAll(async () => {
  await closeDb();
});

describe('limit orders + hybrid routing', () => {
  let askPrice = 0;

  it('rests a non-crossing sell with share escrow', async () => {
    const before = await held(alice);
    const [a] = await db()`select p0 + m * supply as spot from assets where id = ${assetId}`;
    askPrice = Math.round((a!.spot + 0.1) * 100) / 100; // just above market
    const placed = await placeLimitOrder(alice, {
      assetId, side: 'sell', limitPrice: askPrice, qty: 20, now: NOW,
    });
    expect(placed.orderId).not.toBeNull();
    expect(placed.executedQty).toBe(0);
    expect(await held(alice)).toBeCloseTo(before - 20, 9); // escrowed
  });

  it('a market buy walks the curve to the ask, then fills it at maker price', async () => {
    const bobCashBefore = await cash(bob);
    await executeUserTrade(bob, { assetId, side: 'buy', notional: 999, now: NOW });
    const bookFills = await db()`
      select * from trades where venue = 'book' and user_id = ${bob} and not maker
    `;
    expect(bookFills.length).toBeGreaterThan(0); // part of the flow crossed the ask
    const [makerRow] = await db()`
      select * from trades where venue = 'book' and user_id = ${alice} and maker
    `;
    expect(makerRow).toBeDefined();
    expect(makerRow!.side).toBe('sell');
    expect(Number(makerRow!.price_before)).toBeCloseTo(askPrice, 6); // maker's price
    expect(await cash(bob)).toBeLessThan(bobCashBefore);
  });

  it('supply reconstructs from curve rows only', async () => {
    const [a] = await db()`select supply from assets where id = ${assetId}`;
    const [{ replayed }] = (await db()`
      select coalesce(sum(case when side = 'buy' then qty else -qty end)
        filter (where venue = 'curve'), 0) as replayed
      from trades where asset_id = ${assetId}
    `) as unknown as [{ replayed: number }];
    expect(a!.supply).toBeCloseTo(replayed, 6);
  });

  it('cash conservation: every play-dollar is somewhere', async () => {
    // total user cash + curve reserve + escrowed bids == 3 stacks
    const [{ total }] = (await db()`
      select sum(cash) as total from balances where season_id = ${seasonId}
    `) as unknown as [{ total: number }];
    const [{ reserve }] = (await db()`
      select reserve from assets where id = ${assetId}
    `) as unknown as [{ reserve: number }];
    const [{ escrow }] = (await db()`
      select coalesce(sum(remaining * limit_price), 0) as escrow
      from orders where status = 'open' and side = 'buy'
    `) as unknown as [{ escrow: number }];
    expect(total + reserve + escrow).toBeCloseTo(30_000, 4);
  });

  it('cancel refunds the remaining escrow', async () => {
    const placed = await placeLimitOrder(carol, {
      assetId, side: 'buy', limitPrice: 5, qty: 10, now: NOW, // far below market: rests
    });
    expect(placed.orderId).not.toBeNull();
    const cashAfterPlace = await cash(carol);
    await cancelOrder(carol, placed.orderId!, NOW);
    expect(await cash(carol)).toBeCloseTo(cashAfterPlace + 50, 6);
  });

  it('a crossing limit buy executes within its limit and rests the remainder', async () => {
    const [a] = await db()`select p0, m, supply from assets where id = ${assetId}`;
    const spot = a!.p0 + a!.m * a!.supply;
    const limit = spot + 0.03; // just above market
    const placed = await placeLimitOrder(carol, {
      assetId, side: 'buy', limitPrice: limit, qty: 30, now: NOW,
    });
    expect(placed.executedQty).toBeGreaterThan(0); // took curve up to the limit
    expect(placed.restingQty).toBeGreaterThan(0); // rest waits on the book
    const [after] = await db()`select p0 + m * supply as p from assets where id = ${assetId}`;
    expect(after!.p).toBeLessThanOrEqual(limit + 1e-6); // never paid past the limit
  });
});

describe('copy-trading', () => {
  it('replicates a leader trade proportionally, tagged with provenance', async () => {
    await enableCopy(carol, 'alice');
    const before = await held(carol);
    const lead = await executeUserTrade(alice, { assetId, side: 'buy', notional: 300, now: NOW });
    const { copied } = await copyTick(seasonId, new Date(NOW.getTime() + 60e3));
    expect(copied).toBeGreaterThan(0);
    expect(await held(carol)).toBeGreaterThan(before);
    const [row] = await db()`
      select copied_from from trades where user_id = ${carol} and copied_from is not null
      order by id desc limit 1
    `;
    expect(Number(row!.copied_from)).toBe(lead.tradeId);
  });

  it('copied trades are never re-copied (cascade guard)', async () => {
    // bob copies carol; carol's replicated trade must not fan out to bob
    await enableCopy(bob, 'carol');
    const bobBefore = await held(bob);
    const { copied } = await copyTick(seasonId, new Date(NOW.getTime() + 120e3));
    expect(copied).toBe(0); // nothing new from real leaders; carol's copy excluded
    expect(await held(bob)).toBeCloseTo(bobBefore, 9);
  });

  it('cannot copy yourself', async () => {
    await expect(enableCopy(alice, 'alice')).rejects.toThrow(/yourself/);
  });
});
