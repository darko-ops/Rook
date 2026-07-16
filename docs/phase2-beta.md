# Phase 2 — Closed Beta Runbook

Phase 2 (§18) is an *operational* phase: 50–300 real people from a real
friend group, at least one full race cycle (ideally three), the daily-open
loop instrumented obsessively. This doc is how to run it with what's built.

## Launch sequence

```sh
docker compose up -d && npm run -w @rook/db migrate

# 1. open the real season (seeds the 2026 race calendar)
cd workers
npx tsx src/beta.ts open-season "F1 2026 Beta" 2026-12-13

# 2. real news on (synthetic is the dev default)
npx tsx src/beta.ts news rss

# 3. gate the door, mint codes for the friend group
npx tsx src/beta.ts gate on
npx tsx src/beta.ts invites 50

# 4. run the workers (news → mover → snapshots → scores, every 5m)
npm run -w workers run

# 5. run the app
npm run -w web dev        # or build + start behind any boring host
```

Seed the leaderboard **before** widening: get the first ~20 friends in and
trading for a week so day-one joiners see a live market and a real board
(§18: "seed leaderboards before opening the doors").

Mid-season joiners get the standard equal stack automatically and a
provisional Rook Score badge until they've been scored for
`provisionalWindows` weeks.

## Monitoring

- **`/ops`** — §18 exit gates plus the loop metrics, live.
- **`npx tsx src/beta.ts metrics`** — same numbers in the terminal.
- Both compute from the `events` instrumentation (`open:portfolio`,
  `open:market`, `open:leaderboard`, `trade`, `follow`, `login`).

§18 exit criteria (directional targets — calibrate in beta):

| Gate | Target |
|------|--------|
| Non-race-day open share of weekly actives | ≥ 40% |
| D7 retention, friend-graph-connected users | ≥ 35% |
| Median leaderboard views per active | ≥ 2×/week |
| Fairness: house share p95, trader-active asset-days | ≤ cap C (R1) |

## News & classification

Real news flows from public RSS (Autosport, Motorsport.com, RaceFans, BBC
Sport) through a **conservative classifier**: only single-team headlines
with unambiguous keyword sentiment get a sign; everything else lands in the
feed as display-only news the mover never touches. Under-moving is
recoverable (§13.2); a wrong house nudge is a fairness incident.

- Alias table (`packages/core/src/classify.ts`) carries the 2026 driver
  lineups — **update it on driver moves**.
- Watch misclassifications weekly: `select headline, sign from news_events
  where url is not null and sign is not null order by ts desc` — a wrongly
  signed headline that moved a price is an incident (below).
- Feeds are config (`key='news'`, `{"mode":"rss","feeds":[...]}`); failures
  degrade gracefully.

## Fairness incidents

"No unresolved fairness incident" is an exit criterion. An incident is any
of: house share of an asset's daily move over cap on a trader-active day
(watch `/ops`), a wrongly-signed headline that moved a price, a
leaderboard-manipulation win (wash/pump that the score didn't neutralize).

Process: freeze nothing, hide nothing — the mover's decisions are all in
`mover_log`, every price change is in `trades`. Diagnose from the audit
trail, tune the config knob (versioned `config` table, never a hot-patch),
and note the change. If a score was gamed, the formula coefficients are the
fix (§14) — season resets bound the damage.

## Scope fence (unchanged, §18)

No cash-out, no redeemable currency, no paid-entry contests, no buying
position, no copy-trading, no order book, no second league, no metric that
predicts sport. Anything that breaches the fence is a phase decision, not a
feature request.

## Known operational gaps (accepted for beta)

- Auth is handle + invite code (no email verification) — fine for a
  known friend group; magic-link before public launch.
- The 2026 race calendar dates in `races.ts` are best-effort — verify
  against the official calendar; they drive metrics cadence only.
- Season lifecycle: settlement (`beta settle <id>`) is manual by design —
  Endgame week deserves a human hand on the lever.
- Hosting: everything runs on one box + Postgres; deploy to any boring
  host (Fly/Railway/Vercel + managed Postgres) when the friend group
  outgrows a laptop.
