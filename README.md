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

## v1 at a glance

- **Brand:** Rook is the investor, not the exchange — everyone's a portfolio
  manager. Website: **rook.ai** · App: **Rook** · Ranks: Rookie → Grandmaster
- **One league:** F1 (~10 constructor assets, season-scoped)
- **Three screens:** Portfolio (home) · Market (a team) · Leaderboard + profiles
- **Market mechanics:** pure-sentiment AMM + capped, decaying house baseline mover
- **Reputation:** Rook Score — Elo-style, equal starting stacks, skill not spend
- **Money:** play-money only, no cash-out, no real-money anything
