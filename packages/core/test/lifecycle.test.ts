import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, migrate } from '@rook/db';
import {
  executeUserTrade,
  joinSeason,
  login,
  openSeason,
  placeLimitOrder,
  rolloverSeason,
  snapshotPrices,
} from '@rook/core';

const NOW = new Date('2026-03-03T12:00:00Z');
const ENDS = new Date('2026-03-10T12:00:00Z');
let seasonId: number;
let dana: number;
let evan: number;
let assetId: number;

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
      config, events, orders, copy_follows, copy_cursor, standings, races,
      index_points, moments, api_keys restart identity cascade
  `);
  seasonId = await openSeason(
    'f1-test3', 'Season One',
    [{ symbol: 'AAA', name: 'Team A', color: '#fff' }],
    new Date('2026-03-01T00:00:00Z'),
    ENDS,
  );
  dana = (await login('dana', NOW)).userId;
  evan = (await login('evan', NOW)).userId;
  await joinSeason(dana, seasonId, NOW);
  await joinSeason(evan, seasonId, NOW);
  const [a] = await db()`select id from assets where season_id = ${seasonId}`;
  assetId = a!.id;

  // trading + open orders on both sides, then a price snapshot for TWAP
  await executeUserTrade(dana, { assetId, side: 'buy', notional: 800, now: NOW });
  await executeUserTrade(evan, { assetId, side: 'buy', notional: 400, now: NOW });
  await placeLimitOrder(dana, { assetId, side: 'sell', limitPrice: 25, qty: 10, now: NOW }); // escrows 10 shares
  await placeLimitOrder(evan, { assetId, side: 'buy', limitPrice: 5, qty: 20, now: NOW }); // escrows $100
  await snapshotPrices(new Date(ENDS.getTime() - 3 * 86400e3));
  // seed a rating to carry
  await db()`insert into scores (user_id, season_id, rook_score, windows_played)
    values (${dana}, ${seasonId}, 1275, 8), (${evan}, ${seasonId}, 1140, 8)`;
});

afterAll(async () => {
  await closeDb();
});

describe('the season turn (settle → re-issue → carry)', () => {
  let newSeasonId: number;

  it('rolls over: settles old, opens new', async () => {
    newSeasonId = await rolloverSeason(
      seasonId, 'Season Two', ENDS, new Date('2026-07-01T00:00:00Z'), ENDS,
    );
    const [old] = await db()`select status from seasons where id = ${seasonId}`;
    const [next] = await db()`select status from seasons where id = ${newSeasonId}`;
    expect(old!.status).toBe('settled');
    expect(next!.status).toBe('open');
  });

  it('settlement destroyed no escrowed value (the v2 bug)', async () => {
    // all orders cancelled; dana's escrowed 10 shares were refunded before
    // TWAP conversion, evan's $100 bid escrow returned
    const orders = await db()`select status from orders`;
    expect(orders.every((o) => o.status === 'cancelled')).toBe(true);

    const [settled] = await db()`select settled_price from assets where id = ${assetId}`;
    const twap: number = settled!.settled_price;
    expect(twap).toBeGreaterThan(10);

    // every share ever held (incl. dana's escrowed 10) was paid at TWAP:
    // final cash = stack − cost + qty·twap for each user, no leaks
    const rows = await db()`
      select b.user_id, b.cash from balances b where b.season_id = ${seasonId} order by b.user_id
    `;
    for (const r of rows) {
      const [{ paid }] = (await db()`
        select coalesce(-sum(cash_delta), 0) as paid from trades
        where user_id = ${r.user_id} and venue = 'curve'
      `) as unknown as [{ paid: number }];
      const [{ qty }] = (await db()`
        select coalesce(sum(case when side = 'buy' then qty else -qty end), 0) as qty
        from trades where user_id = ${r.user_id}
      `) as unknown as [{ qty: number }];
      expect(r.cash).toBeCloseTo(10_000 - paid + qty * twap, 4);
    }
  });

  it('re-issues assets at the flat p0 with zero supply', async () => {
    const [a] = await db()`
      select symbol, supply, reserve, p0 + m * supply as price from assets
      where season_id = ${newSeasonId}
    `;
    expect(a!.symbol).toBe('AAA');
    expect(a!.supply).toBe(0);
    expect(a!.reserve).toBe(0);
  });

  it('everyone re-receives the standard stack; Rook Scores carry', async () => {
    const balances = await db()`
      select user_id, cash from balances where season_id = ${newSeasonId} order by user_id
    `;
    expect(balances).toHaveLength(2);
    for (const b of balances) expect(b.cash).toBe(10_000);
    const scores = await db()`
      select user_id, rook_score from scores where season_id = ${newSeasonId} order by rook_score desc
    `;
    expect(scores).toHaveLength(2);
    expect(scores[0]!.rook_score).toBe(1275); // dana's rating persisted
    expect(scores[1]!.rook_score).toBe(1140);
  });

  it('career record shows the settled season on the profile query', async () => {
    const { traderProfile } = await import('@rook/core');
    const p = await traderProfile('dana', newSeasonId, ENDS, null);
    expect(p!.career.some((c) => c.season === 'Season One' && Math.round(c.rookScore) === 1275)).toBe(true);
  });

  it('config patches fold cumulatively — a later patch keeps earlier ones', async () => {
    const { loadConfig, setConfig } = await import('@rook/core');
    // dated before every other config write in this suite so the fold
    // order stays: these patches → the settlement test's mode patch
    const t0 = new Date('2026-01-01T00:00:00Z');
    await setConfig({ settlement: { mode: 'standings' } }, t0);
    await setConfig({ trading: { maxTradesPerAssetPerDay: 99 } }, new Date(t0.getTime() + 1000));
    const cfg = await loadConfig(new Date(t0.getTime() + 2000));
    expect(cfg.settlement.mode).toBe('standings'); // not clobbered
    expect(cfg.trading.maxTradesPerAssetPerDay).toBe(99);
    await setConfig({ settlement: { mode: 'twap' }, trading: { maxTradesPerAssetPerDay: 30 } }, new Date(t0.getTime() + 3000));
  });

  it('standings mode settles at the payout table (decision H)', async () => {
    const { setConfig, settleSeason, defaultTeamPayout } = await import('@rook/core').then(
      async (m) => ({
        setConfig: m.setConfig,
        settleSeason: m.settleSeason,
        defaultTeamPayout: (await import('@rook/engine')).defaultConfig.settlement.teamPayouts,
      }),
    );
    await setConfig({ settlement: { mode: 'standings' } }, ENDS);
    // give the new season's asset a standing: P1
    const [asset] = await db()`select id from assets where season_id = ${newSeasonId}`;
    await db()`insert into standings (season_id, asset_id, round, position, points, wins)
      values (${newSeasonId}, ${asset!.id}, 20, 1, 400, 10)`;
    await executeUserTrade(dana, { assetId: asset!.id, side: 'buy', notional: 200, now: ENDS });
    await settleSeason(newSeasonId, new Date('2026-07-01T00:00:00Z'));
    const [settled] = await db()`select settled_price from assets where id = ${asset!.id}`;
    expect(settled!.settled_price).toBe(defaultTeamPayout[0]); // P1 pays the top payout
    await setConfig({ settlement: { mode: 'twap' } }, new Date('2026-07-02T00:00:00Z'));
  });
});
