import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, migrate } from '@rook/db';
import {
  executeUserTrade,
  joinSeason,
  loadConfig,
  login,
  moverTick,
  openSeason,
  setConfig,
  snapshotPrices,
  TradeRejected,
} from '@rook/core';

const NOW = new Date('2026-03-01T12:00:00Z');
let seasonId: number;
let userId: number;
let assetId: number;

beforeAll(async () => {
  await migrate();
  const sql = db();
  // isolated test season namespace: wipe everything (dev DB only)
  await sql.unsafe(`
    truncate users, sessions, seasons, assets, balances, holdings, trades,
      price_points, news_events, mover_log, scores, score_windows, follows,
      config, events restart identity cascade
  `);
  seasonId = await openSeason(
    'f1-test',
    'Test Season',
    [
      { symbol: 'AAA', name: 'Team A', color: '#fff' },
      { symbol: 'BBB', name: 'Team B', color: '#000' },
    ],
    new Date('2026-03-01T00:00:00Z'),
    new Date('2026-07-01T00:00:00Z'),
  );
  const u = await login('tester', NOW);
  userId = u.userId;
  await joinSeason(userId, seasonId, NOW);
  const [a] = await db()`select id from assets where season_id = ${seasonId} and symbol = 'AAA'`;
  assetId = a!.id;
});

afterAll(async () => {
  await closeDb();
});

describe('trade path', () => {
  it('executes a buy: balance, holding, trade row, asset state all consistent', async () => {
    const t = await executeUserTrade(userId, { assetId, side: 'buy', notional: 500, now: NOW });
    expect(t.cashDelta).toBeCloseTo(-500, 6);
    expect(t.priceAfter).toBeGreaterThan(t.priceBefore);

    const [bal] = await db()`select cash from balances where user_id = ${userId}`;
    expect(bal!.cash).toBeCloseTo(9500, 6);
    const [h] = await db()`select qty from holdings where user_id = ${userId} and asset_id = ${assetId}`;
    expect(h!.qty).toBeCloseTo(t.qty, 9);
    const [a] = await db()`select supply, reserve from assets where id = ${assetId}`;
    expect(a!.supply).toBeCloseTo(t.qty, 9);
    expect(a!.reserve).toBeCloseTo(500, 6);
  });

  it('round trip returns the reserve to zero (closed loop on the curve)', async () => {
    const [h] = await db()`select qty from holdings where user_id = ${userId} and asset_id = ${assetId}`;
    await executeUserTrade(userId, { assetId, side: 'sell', qty: h!.qty, now: NOW });
    const [a] = await db()`select supply, reserve from assets where id = ${assetId}`;
    expect(a!.supply).toBeCloseTo(0, 9);
    expect(Math.abs(a!.reserve)).toBeLessThan(1e-6);
    const [bal] = await db()`select cash from balances where user_id = ${userId}`;
    expect(bal!.cash).toBeCloseTo(10_000, 6);
  });

  it('rejects: size cap, insufficient cash, insufficient holdings, rate limit', async () => {
    await expect(
      executeUserTrade(userId, { assetId, side: 'buy', notional: 5000, now: NOW }),
    ).rejects.toThrow(TradeRejected);
    await expect(
      executeUserTrade(userId, { assetId, side: 'sell', qty: 1, now: NOW }),
    ).rejects.toThrow(/not enough shares/);

    // rate limit: config allows N per asset per day
    const cfg = await loadConfig(NOW);
    await setConfig({ trading: { maxTradesPerAssetPerDay: 3 } }, new Date(NOW.getTime() - 1));
    let rejected = false;
    try {
      for (let i = 0; i < 5; i++) {
        await executeUserTrade(userId, { assetId, side: 'buy', notional: 10, now: NOW });
      }
    } catch (e) {
      rejected = e instanceof TradeRejected && e.code === 'rate-limit';
    }
    expect(rejected).toBe(true);
    await setConfig({ trading: { maxTradesPerAssetPerDay: cfg.trading.maxTradesPerAssetPerDay } }, NOW);
  });

  it('price is reconstructible from the trade log', async () => {
    const [a] = await db()`select p0, m, supply from assets where id = ${assetId}`;
    const trades = await db()`
      select side, qty from trades where asset_id = ${assetId} order by id
    `;
    let supply = 0;
    for (const t of trades) supply += t.side === 'buy' ? t.qty : -t.qty;
    expect(supply).toBeCloseTo(a!.supply, 6);
  });

  it('concurrent buys serialize per asset (single-writer)', async () => {
    const before = await db()`select supply from assets where id = ${assetId}`;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        executeUserTrade(userId, { assetId: assetId, side: 'buy', notional: 25, now: new Date(NOW.getTime() + 86400e3) }),
      ),
    );
    const [a] = await db()`select supply, reserve from assets where id = ${assetId}`;
    const trades = await db()`select qty, side from trades where asset_id = ${assetId} order by id`;
    let supply = 0;
    for (const t of trades) supply += t.side === 'buy' ? t.qty : -t.qty;
    expect(a!.supply).toBeCloseTo(supply, 6);
    expect(a!.supply).toBeGreaterThan(before[0]!.supply);
  });
});

describe('mover through the same path', () => {
  it('executes flagged house trades and logs every decision', async () => {
    const sql = db();
    const [b] = await sql`select id from assets where season_id = ${seasonId} and symbol = 'BBB'`;
    await sql`
      insert into news_events (ts, headline, source, asset_id, sign, magnitude)
      values (${NOW}, 'Team B win from lights to flag', 'test', ${b!.id}, 1, 'large')
    `;
    const res = await moverTick(new Date(NOW.getTime() + 60e3));
    expect(res.executed + res.skipped).toBe(1);
    const logs = await sql`select * from mover_log`;
    expect(logs.length).toBe(1);
    if (res.executed === 1) {
      const [t] = await sql`select actor, user_id from trades where id = ${logs[0]!.trade_id}`;
      expect(t!.actor).toBe('house');
      expect(t!.user_id).toBeNull();
    }
    const [ev] = await sql`select processed_by_mover from news_events`;
    expect(ev!.processed_by_mover).toBe(true);
  });

  it('snapshots write one price point per open asset', async () => {
    const n = await snapshotPrices(new Date(NOW.getTime() + 120e3));
    expect(n).toBe(2);
  });
});
