# Rook

**Own the season.**

Rook is a play-money exchange where fans build portfolios of sports teams,
watch them move on real-world news, and climb a reputation ranking against
their friends. Dark, minimal, and unmistakably not a sportsbook.

> Rook shouldn't be right. Rook should be fair.

## Docs

- [Full Breakdown](docs/rook-breakdown.md) — strategy, analysis, risk
  register, phase plan (Phase 0 → launch), concrete v1 build instructions
  (stack, data model, API, screens), and background notes for later
  versions (order book, copy-trading, premium tier, EPL, real-money paths).
- [v1 Product Spec](docs/v1-product-spec.md) — the tight reference: what v1
  is, the three screens, core market mechanics, ship sequence, and open
  decisions.
- [Phase 0 Results](docs/phase0-results.md) — AMM/mover/Rook-Score simulation
  evidence and the validated v1 config.

## Repo

```
packages/engine/   # AMM math, house mover, Rook Score — pure, deterministic, tested
packages/db/       # Postgres schema, migrations, connection (§21)
packages/core/     # services: trade path, news, mover tick, scoring, queries
apps/web/          # Next.js PWA: the three screens + §22 API (port 3300)
workers/           # worker cycle (news → mover → snapshots → scores) + dogfood
sim/               # Phase 0 simulation harness (agents, news stream, sweeps)
docs/
```

```sh
npm install
docker compose up -d              # Postgres 16 on :5455
npm run -w @rook/db migrate       # apply schema
npm test                          # engine unit + core integration tests
npm run sim                       # Phase 0 sweeps → sim/out/
npm run -w workers dogfood        # §17 exit test: fake half-season, end to end
npm run -w web dev                # app on http://localhost:3300
npm run -w workers run            # worker daemon (5m ticks) alongside the app
```

The dogfood run leaves the database populated mid-season, so the app is
immediately browsable: sign in with any handle, you join with the standard
$10,000 stack.

## v1 at a glance

- **Brand:** Rook is the investor, not the exchange — everyone's a portfolio
  manager. Website: **rook.ai** · App: **Rook** · Ranks: Rookie → Grandmaster
- **One league:** F1 (~10 constructor assets, season-scoped)
- **Three screens:** Portfolio (home) · Market (a team) · Leaderboard + profiles
- **Market mechanics:** pure-sentiment AMM + capped, decaying house baseline mover
- **Reputation:** Rook Score — Elo-style, equal starting stacks, skill not spend
- **Money:** play-money only, no cash-out, no real-money anything
