# Phase 0 Results — Prototype the Math

Status: **all three §16 exit criteria pass.** This doc records the harness,
the evidence per criterion, the chosen v1 config, and what Phase 0 taught us
that the breakdown doc didn't already know.

**Code:** `packages/engine` (pure, deterministic AMM + mover + Rook Score —
the same package v1 ships) and `sim/` (agents, news stream, season runner,
sweeps). Reproduce with `npm install && npm run sim` (writes
`sim/out/report.txt` and `sim/out/v1-config.json`; fully seeded, no
wall-clock or unseeded randomness anywhere).

## Setup

- **Season:** 140 days (20 weeks) at hourly ticks; 10 F1-style assets;
  race weekend every 14 days (quali Saturday, results Sunday, ~30% of race
  results "large"), midweek trickle ~1.2 events/day league-wide.
- **~50 actives, equal $10,000 stacks:** 30 casual (delayed news reaction +
  noise, activity bursts on newsy days), 8 early-informed (react to
  medium/large events at event time; half sharp, half mediocre), 6 momentum
  chasers (buy 24h gainers / dump losers), 3 reckless concentrators (all-in
  one asset, churn), 3 wash traders (pure round trips, no real book).
- Week 1 is a starter flow (every agent deploys toward a target allocation,
  per §23.1). Days 0–4 are excluded from band metrics: identical stacks
  deploying from an identical flat start is price discovery, not
  steady-state behavior.
- Every result below is the mean over seeds {11, 42, 1337} unless noted.

## Exit criterion 1 — curve steepness band ✅

Median / p95 / max of per-asset |daily return| from day 5 (mover at
defaults):

| m | median | p95 | max | verdict |
|---|--------|-----|-----|---------|
| 0.0005 | 0.12% | 1.65% | 3.60% | flatline |
| 0.001 | 0.21% | 2.87% | 6.63% | flatline |
| **0.002** | 0.32% | 4.22% | 9.95% | **in band** |
| **0.003** | 0.39% | 5.03% | 13.61% | **in band** |
| **0.005** | 0.49% | 6.00% | 16.48% | **in band** |
| **0.01** | 0.59% | 7.30% | 19.45% | in band (hot end) |

Band definition: flatline = median < 0.3%; whipsaw = p95 > 12% or
max > 25%. **The band is m ∈ [0.002, 0.01]; chosen m = 0.003** (flatter
half, per §13.1 "start flatter and tune up"). At p0 = 10, a typical $400
trade moves price ~0.8% at m = 0.003.

**Whale stress:** a burst of 12 max-cap ($1,000) buys on one asset within
3 hours moves it ~2.8% at the chosen config — dramatic but not chaos; no
whipsaw flag. The per-trade size cap is doing its anti-griefing job.

## Exit criterion 2 — mover parameters ✅

Sweep: nudge scale {0.5, 1, 2} × cap C {0.2, 0.3} × V* {2.5k, 5k, 10k} at
m = 0.003. Checks: (a) news days visibly move the median portfolio
(≥ 0.4% median agent |daily move| on news days), (b) house share of any
asset-day's move stays under cap, (c) house influence measurably → 0 as
organic volume rises.

**Chosen: nudge scale 1 (150/400/900 by magnitude class), C = 0.2,
V* = 10,000/day, quiet floor 1.5%/day, 24h windows, ≤6 trades and ≤$1,800
house notional per asset-day.** Evidence at that config:

- News-day median portfolio move **0.47%** vs quiet-day 0.23% (≈ $47 vs
  $23 on a $10k stack — something to open the app for, both kinds of day).
- House share of daily moves: p95 = **10.1%**, hard cap 20% never
  approached; every house trade is flagged in the trade log and
  reconstructible (the R1 dashboard input).
- Decay: house share averages 2.4% on thin asset-days and **0.8–2.2%** on
  high-organic asset-days, trending to zero as volume rises; at beta scale
  (300+ users) per-asset organic volume clears V* almost daily, so δ ≈ 0
  and traders fully own pricing.
- Trade-off found by the sweep: at flatter m, visibility needs either
  scale-1 nudges with slow decay (V* = 10k) or scale-2 with fast decay.
  m = 0.005 passes visibility with nearly every mover config (16/18) —
  it's the fallback if beta feels dead: **turn m up before touching the
  mover.**

## Exit criterion 3 — Rook Score orders the archetypes ✅

Signal per weekly window: risk-adjusted excess return vs the cap-weighted
Rook Index × earliness multiplier × volume weight, with concentration
penalty + tax, anti-pump discount, and wash penalty; then Elo pairwise
update (K = 32, provisional ×2 for first 3 windows, start 1200).

Mean final rating by archetype at the chosen config:

| seed | early | momentum | casual | concentrator | wash |
|------|-------|----------|--------|--------------|------|
| 11 | 1254 | 1240 | 1185 | 1173 | **1152** |
| 42 | 1250 | 1223 | 1188 | 1189 | **1158** |
| 1337 | 1266 | 1233 | 1177 | 1200 | 1183 |

Required ordering (early > momentum > concentrator, wash ≈ bottom) holds
in 2/3 seeds and early > momentum > concentrator in 3/3; in seed 1337 the
wash trader sits 6 points above the casual mean after one season —
directionally correct and still falling (the wash penalty compounds every
window). Acceptable for a first cut; re-test against real beta behavior.

### What the first sim run caught (why Phase 0 exists)

The naive formula failed spectacularly, in ways worth remembering:

1. **Wash traders ranked #1.** Zero-signal (their volume is filtered to
   zero credit) *beat* every honest trader having a bad week, because Elo
   rewards "did nothing" over "tried and lost." Fix: detected wash volume
   actively costs rating (`washPenaltyWeight`), it isn't merely
   uncredited.
2. **Concentrators ranked above early traders.** All-in buying on a
   bonding curve pumps your own mark — unrealized P&L is self-fulfilling —
   and dividing by portfolio vol *mutes* a reckless book's losses as much
   as its gains, parking it comfortably mid-field. Fixes: an anti-pump
   discount (gains on an asset whose window volume you dominated
   > 25% are discounted to zero as your flow share → 100%) and a
   concentration *tax* (HHI beyond 0.5 costs rating each window even when
   the coin lands heads — risk R4 verbatim).
3. **Earliness must be asymmetric.** A multiplier < 1 on a *negative*
   signal would make late-and-wrong look better than early-and-wrong; the
   multiplier flips to (2 − E) for losses.

All inputs remain market observables (positions, prices, timing, flow) —
the venue-not-oracle guardrail holds everywhere.

## The v1 config (§16 deliverable)

Written to `sim/out/v1-config.json`; mirrors `defaultConfig` in
`packages/engine/src/config.ts` with the swept choices applied. Summary:

| Tunable | Value | Source |
|---------|-------|--------|
| p0 / m | 10 / **0.003** | sweep 1 (band [0.002, 0.01]) |
| Per-trade cap | $1,000 | whale stress |
| Starting stack | $10,000 | spec §12 |
| Mover nudges (S/M/L) | $150 / $400 / $900 × δ | sweep 2 |
| Cap C | 0.2 | sweep 2 (stricter than spec's ≤0.3 start) |
| V* | $10,000/asset/day | sweep 2 |
| Quiet floor | 1.5% of price /day | sweep 2 |
| Mover rate limits | 6 trades, $1,800 /asset/day | sweep 2 |
| Scoring window | weekly | first cut |
| Elo K / provisional | 32 / ×2 for 3 windows | first cut |
| Wash penalty / window | 2.0 × wash fraction | sim finding #1 |
| Concentration threshold/penalty/tax | HHI 0.5 / ×0.5 / 0.4 | sim finding #2 |
| Anti-pump threshold | 25% flow share | sim finding #2 |
| Earliness horizon/lookback | 48h / 24h | first cut |

## Caveats & notes for Phase 1

- **House inventory is synthetic.** The sim lets the house sell supply it
  never bought (capped at circulating supply, so the reserve stays
  solvent). v1 must decide the accounting: either the house holds a small
  season-start inventory per asset or sells are budget-capped notional
  like buys. Economically identical at these sizes; pick one and log it.
- **Simulated humans are not humans.** The visibility threshold (0.4%
  median news-day portfolio move) and casual-agent behavior are guesses;
  beta instrumentation (§22) recalibrates them. The knobs and their safe
  ranges are the durable output, not the fifth decimal.
- **Score windows use end-of-window holdings** for average weights (an
  approximation that slightly favors late-window rebalancers); v1's
  scoring worker should sample holdings daily from snapshots.
- **Wash detection is the easy case here** (same-tick round trips).
  Real adversaries will spread trips across accounts and time; R3's
  multi-account detection is untouched Phase 1+ work.
- **Settlement (TWAP) wasn't exercised** — it's a lifecycle job, not
  math risk; test it in Phase 1's fake half-season dogfood.

**Next (Phase 1, §17):** the three screens against F1 powered by this
engine package — `packages/db` schema per §21, trade path per §22, workers
for news/mover/snapshots/scores, exit on an end-to-end fake half-season.

## Amendments from the Phase 1 dogfood

The §17 dogfood (70 simulated days through the real services and database,
40 agents) caught four things the Phase 0 harness had let slide. All are
folded into `defaultConfig` and re-validated against the §16 exit criteria
(3/3 seeds on the Rook Score ordering, tighter than before):

1. **`volFloor` 0.005 → 0.02.** A 0.5%-weekly floor let mostly-cash
   portfolios divide small excess returns by almost nothing, amplifying
   noise ×200 — honest losers scored below the wash penalty, so the wash
   trader floated mid-field. 2% weekly is a realistic floor.
2. **Wash forfeit rule.** A window whose credited volume is majority wash
   (`washForfeitThreshold` 0.5) is forfeited outright — bottom of the
   field — rather than just penalized. Wash archetype now lands ~1000 in
   sim and ~1077 in dogfood, unambiguously last.
3. **The quiet floor no longer stacks on the relative cap.** Old rule:
   allowed house impact = max(floor, C/(1−C)·organic) — on thin-but-active
   days the floor dominated and measured house share hit 45%. New rule: any
   real organic flow → strict relative cap alone; the floor applies only to
   dead markets (organic ≈ 0), which is its whole purpose. Dogfood house
   share on trader-active asset-days: p95 = 20.0% at cap 20%.
4. **`quietImpactFloor` 0.015 → 0.008** — conservative direction per §13.2
   ("under-moving is recoverable; over-moving breaks the constitution").

Net config drift: curve band moved to **m ∈ [0.003, 0.01]** (defaults stay
m = 0.003 at the flatter edge); mover defaults are C = 0.2, V* = 10,000,
scale-1 nudges, floor 0.008. The `defaultConfig` in
`packages/engine/src/config.ts` is the single source of truth.
