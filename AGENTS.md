# Rook — Agent & Contributor Guide

Rook is a play-money exchange where fans build portfolios of sports teams
(F1 constructors + drivers) and compete on an Elo-style reputation ranking.
Dark, minimal, financial-instrument aesthetic — not a sportsbook.

**Read before large changes:** `docs/v1-product-spec.md` (tight spec),
`docs/rook-breakdown.md` (strategy, architecture rationale, build guide),
`docs/phase0-results.md` (validated engine tunables).

## The constitution (hard rules — never violate)

1. **Rook prices nothing; it measures everything.** No code path may set,
   target, or predict an asset's price. The market (users trading on the
   bonding curve / order book) sets price. The house mover only nudges
   *direction*, is hard-capped (`mover.capC`), and decays to zero with
   organic volume — never weaken those constraints.
2. **Every metric must be computable from market activity alone** (trades,
   flow, holdings, timing) — never from sporting prediction. "Confidence"
   means confidence-of-the-market, never confidence-in-the-team. Standings
   are display context and settlement input (a disclosed rule), not a
   pricing input.
3. **Equal starting stacks; money never buys position.** No top-ups, no
   purchasable currency, no transfers. Anything paid is cosmetic or
   analytics-depth only.
4. **Play-money only in v1.** No cash-out, no redeemable currency, no
   paid-entry prizes. Real-money is a legal project, not a feature flag.
5. **Fairness is visible.** Every price change must be reconstructible from
   the append-only `trades` table; house trades are flagged
   (`actor = 'house'`) and logged in `mover_log`; mechanics are disclosed
   on the fairness page. Never soft-delete or rewrite trade history.
6. **Chess vocabulary lives in status/identity** (Rookie → Grandmaster,
   Opening Book, Endgame), **never in trading actions** — Buy/Sell stay
   plain finance verbs. Dark UI only; no casino green.

## Architecture map

```
packages/engine/   PURE + DETERMINISTIC. AMM curve math, mover math, Rook
                   Score. No I/O, no Date.now(), no unseeded randomness —
                   the same code runs in server, tests, and sim/.
packages/db/       Postgres schema (migrations are append-only), client.
packages/core/     Services: trade path, seasons/settlement, standings,
                   news, scoring, orders, copy, queries. All writes to
                   market state go through executeUserTrade / the engine.
apps/web/          Next.js PWA (port 3300): the three screens + API routes.
workers/           Daemon (news → mover → snapshots → scores), dogfood,
                   beta ops, reprice (demo agents).
sim/               Phase 0 simulation harness (imports packages/engine).
```

Invariants to preserve:
- **Trade path is the single writer.** All market mutations go through
  `executeUserTrade` (per-asset serialization, size caps, per-user
  per-asset daily rate limit). Never write `assets.supply`, `holdings`,
  or `balances` directly.
- **Config is versioned, append-only patches** in the `config` table;
  `loadConfig` folds ALL effective rows in order over defaults (there is a
  regression test — a partial patch must never revert earlier patches).
  Never hardcode a tunable.
- **Settlement** (`settleSeason`) honors `settlement.mode`:
  `'standings'` = disclosed payout table by final championship position
  (decision H, the live mode), TWAP fallback. Open orders are cancelled
  with full escrow refunds before settlement.
- **Timestamps flow in as parameters** (`now: Date`) through core/engine
  functions — keep them injectable; tests and sim depend on it.

## Dev workflow

```sh
npm install
docker compose up -d               # Postgres 16 on :5455 (user/pass/db: rook)
npm run -w @rook/db migrate
npm test                           # engine suite, then core (needs the DB)
npm run -w workers dogfood         # seeds a browsable mid-season market
npm run -w web dev                 # app on http://localhost:3300
npm run -w workers run             # worker daemon alongside the app
```

- Tests: `vitest`; core integration tests share one DB and run serially
  (`fileParallelism: false`) — don't parallelize them.
- CI (`.github/workflows/ci.yml`): per-package `tsc --noEmit`, engine and
  core suites run separately, web build. Match it locally before pushing.
- TypeScript throughout, ESM, strict; match existing code style. Keep
  `packages/engine` dependency-free and side-effect-free.

## Danger zones (change only with tests + a careful read)

- `packages/engine/src/mover.ts` + `packages/core/src/mover.ts` — the cap/
  decay logic is the "Rook prices nothing" enforcement. R1 dashboard
  (`/ops`) audits house share of moves; keep it under `capC`.
- `packages/core/src/trade.ts` — balance/holdings/escrow arithmetic and
  rate limiting; every bug here is a fairness incident.
- `packages/core/src/season.ts` — settlement converts holdings to cash and
  re-issues assets; must never destroy escrowed value.
- `packages/core/src/config.ts` — the append-only fold (see invariant).
- `packages/engine/src/score.ts` — Rook Score is the game's incentive
  design; anti-gaming terms (wash, concentration, dominant-flow) are
  load-bearing, not cosmetic.

## Scope fence (v1 — do not add without an explicit product decision)

No cash-out or real money, no purchasable currency, no paid-entry contests,
no metric that requires predicting sporting outcomes, no second league yet.
Order book, copy-trading, and the pro tier exist in code but are gated —
don't surface them further without a phase decision.
