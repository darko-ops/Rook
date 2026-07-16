# Phase 3 — Narrow Public Launch Runbook

§19: launch narrow, ride the "fantasy stock market for sports" narrative,
position explicitly against the sportsbook aesthetic, preserve friend-graph
density with waitlist + invites, and make fairness the marketing.

## The pitch (use everywhere)

> **Rook — Own the season.**
> The fantasy stock market for Formula 1. Build a portfolio of the teams
> you believe in. Equal $10,000 stacks, prices set by fans trading — not by
> bookmakers, not by us. Climb from Rookie to Grandmaster.
> No odds. No bet slips. No cash. Not a sportsbook.

The logged-out landing page carries this narrative with live market prices;
`/fairness` is the proof. Link it in every launch post — disclosed
mechanics are the positioning.

## Launch-day sequence

```sh
# infra (any boring host; compose.prod.yml is the reference)
POSTGRES_PASSWORD=… RESEND_API_KEY=… PUBLIC_URL=https://rook.ai \
  docker compose -f compose.prod.yml up -d --build

cd workers
npx tsx src/beta.ts news rss          # real F1 news
npx tsx src/beta.ts auth magic        # email magic-link sign-in
npx tsx src/beta.ts gate on           # invite-only door
npx tsx src/beta.ts grant-invites 3   # every beta user gets 3 invites
```

Season should already be running with the beta cohort on the board —
day-one joiners must see a live market and a real leaderboard, not an
empty room.

## Growth mechanics

- **Waitlist:** public landing collects emails (`waitlist` table,
  position shown on join). `npx tsx src/beta.ts waitlist` for stats.
- **Waves:** `npx tsx src/beta.ts admit-wave 25` mints single-use codes
  and emails them (referred signups admitted first — friends of players
  before strangers). Start with small waves after each race weekend;
  watch `/ops` D7 before widening.
- **Member invites:** every user sees "Invite friends" on their portfolio
  (3 codes by default). This is the density-preserving channel — prefer
  raising quotas over bigger waitlist waves.

## Environment

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection |
| `RESEND_API_KEY` | email delivery (unset = links log to console) |
| `EMAIL_FROM` | sender identity |
| `PUBLIC_URL` | absolute links in emails |
| `POSTGRES_PASSWORD` | compose.prod.yml only |

## Monitoring (unchanged from Phase 2)

`/ops` + `beta metrics`: §18 gates keep applying after launch. Add-on
launch watch items: waitlist conversion (invited → joined, `beta
waitlist`), invite-quota usage (`invite:mint` events), house share p95
after every user-count step change (R1 — more users should push it toward
zero; if it rises, something is wrong).

## Pre-launch checklist

- [ ] Domain (rook.ai) + TLS at the host; register @rookhq handles (§26)
- [ ] Verify 2026 race calendar dates in `packages/core/src/races.ts`
- [ ] Resend domain verified; `EMAIL_FROM` matches it
- [ ] Fairness page reviewed against actual config values
- [ ] `beta metrics` gates green on the beta cohort
- [ ] Backup: `pg_dump` cron on the host (trades table is the ledger —
      losing it is losing the season)
- [ ] Scope fence re-read (§18): still no cash, no prizes, no exceptions

## What Phase 3 is NOT

No EPL, no order book, no copy-trading, no premium tier, no native app —
each is gated behind this launch proving out (v1.5+ §25). The category
window rewards narrow-and-fast, not broad.
