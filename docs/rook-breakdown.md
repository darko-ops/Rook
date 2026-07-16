# Rook — Full Breakdown: Strategy, Analysis, Phases & v1 Build Guide

> **Own the season.**
>
> Rook is a play-money exchange where fans build portfolios of sports teams,
> watch them move on real-world news, and climb a reputation ranking against
> their friends. Robinhood made everyone feel like an investor; **Rook makes
> everyone feel like a portfolio manager.**

**The line on the wall:** *Rook shouldn't be right. Rook should be fair.*

**Companion doc:** [v1 Product Spec](v1-product-spec.md) — the tight
reference for what ships in v1. This document is the deep version: the
reasoning, the analysis, the phase plan, the build instructions, and the
notes for everything after v1.

---

# Part I — Strategy

## 1. Thesis

Sports fandom already behaves like a market — opinions, conviction, rivalry,
news reaction, season-long narrative — but the only products that let fans
*act* on conviction are sportsbooks (bet-and-resolve, house-versus-player)
and fantasy (roster management, weekly churn). Neither gives a fan the thing
investors get: **a position you hold, a track record you build, and a
reputation you defend.**

Rook's bet is that the *investing* frame — portfolio, returns, rankings —
is a stickier and more durable container for sports conviction than the
*wagering* frame, and that a play-money market can be genuinely engaging if
three things are true:

1. **Prices move daily** (so there's something to open the app for),
2. **Skill is legible** (so the leaderboard means something), and
3. **Reputation compounds** (so quitting has a cost and winning has an
   audience).

The product is the daily-open loop: *my portfolio moved + my reputation is
at stake.* Everything in this document exists to serve that loop.

## 2. Architecture-level strategy: venue, not oracle

Rook is an **exchange/platform, not an oracle**. Users are the investors;
Rook is the venue. Two rules encode the entire architecture:

1. **Rook prices nothing; it measures everything.** The market sets price
   via pure sentiment. The algorithm never sets a price. Rook computes
   everything *except* value.
2. **Every metric must be computable from market activity alone — never
   from sporting prediction.** The moment a metric needs Rook to predict
   whether a team will perform, it has become valuation in disguise. Cut it.

Why this is strategic and not just aesthetic:

- **It's defensible.** An oracle competes with every model shop and pundit
  on being *right*. A fair venue competes on trust and liquidity — network
  effects, not forecasting accuracy.
- **It's regulatorily favorable.** "We operate a fair market and measure
  it" is exactly the framing regulators treat most kindly (the CFTC itself
  cites price discovery as the public-interest justification for event
  contracts). "Our algorithm decides team values" invites every hard
  question at once.
- **It scales across sports.** Measurement infrastructure is
  sport-agnostic; prediction models are not.

## 3. Brand & identity

### Rook is the investor

The brand is the identity users inhabit, not the venue they visit. Homepage
framing:

> **Rook** — *Own the season.*
> Build a portfolio of the teams you believe in.

### Naming structure (decided)

| Surface | Name |
|---------|------|
| Brand | Rook |
| Website | **rook.ai** (buy now; skip .net/.co; don't chase .com yet) |
| App | Rook |
| Handle | Aligned everywhere (e.g. @rookhq) |

`.ai` reinforces the story for a product whose core surface is analytics
and rankings. Nobody says "I'm using rook.ai" — they say "I'm on Rook."

### Chess vocabulary — status, never actions

| Term | Meaning |
|------|---------|
| Rookie | New user |
| Rook Score / Rook Rating | Elo-style reputation |
| Rook Index | Market-wide index |
| Grandmaster | Highest rank |
| Opening Book | Market research / analytics surface |
| Endgame | Season finale |

**Guardrail:** Buy/Sell remain plain finance verbs. Chess vocabulary lives
in ranks, research, and season framing. The moment it touches a trading
action, cut it.

### Visual direction

Very dark UI. Minimal. Financial-instrument, not sportsbook. No casino
green. References: Apple Stocks, Robinhood, Linear, Formula 1.

```
ROOK

Portfolio
+$2,483 (+18.7%)

Holdings

Ferrari        ▲ 5.8%
McLaren        ▲ 3.1%
Red Bull       ▼ 1.4%
Mercedes       ▲ 8.2%
```

## 4. Market context & timing

- **The prediction-market wave is live.** Kalshi/Polymarket made "trade on
  events" a mainstream narrative. Rook rides that wave as *marketing*
  ("the fantasy stock market for sports") while play-money keeps it out of
  the crossfire — Rook benefits from the news without being the news.
- **Sportsbook fatigue is real.** A visible cohort of sports fans is
  alienated by the bet-slip aesthetic and the lose-money default. A
  finance-coded, no-cash product is a differentiated home for them.
- **The category window won't stay open.** "Stock market for sports" is an
  obvious idea; execution and community are the moat. Launching narrow and
  fast matters more than launching broad.

## 5. Competitive frame

| Category | Examples | What they are | Why Rook is different |
|----------|----------|---------------|----------------------|
| Sportsbooks | DraftKings, FanDuel | House-vs-player wagers, bet-and-resolve | Rook has holdings, not bets; no house edge; no cash risk |
| Prediction markets | Kalshi, Polymarket | Binary $0/$1 event contracts | Rook shares are continuous, held, season-scoped — a portfolio, not a position on one question |
| Fantasy | Sleeper, FPL | Roster management vs. scoring rules | Rook prices come from *people*, not a scoring formula; the market is the game |
| Fan tokens | Socios | Real-money tokens, loyalty perks | Rook is skill-legible (equal stacks, Elo), not pay-to-hold |
| Play-money trading | Investopedia sim, fantasy stock apps | Practice for real markets | Rook is a *destination* game with its own reputation economy, not a rehearsal |

The nearest structural neighbor is fan tokens; the decisive differences are
**equal starting stacks** (skill, not spend) and **season-scoped settlement**
(narrative arc, fresh starts).

## 6. Monetization strategy

Charge for **seeing more** and **being more** — never for having more buying
power.

| Line | What | When |
|------|------|------|
| Premium analytics subscription | The measurement layer is the natural paywall: deeper metrics, longer history, advanced screens (Opening Book pro tier) | v1.5+, once free tier proves the loop |
| Cosmetics / profile flair | Identity goods on the reputation layer | v1.5+ |
| Extra portfolios | Power-user surface | v2 |
| Data / index licensing | Sell the measurement layer (indices, sentiment, price discovery) to media, sponsors, analytics firms | Phase 2 revenue — underrated, no gambling nexus |
| Trading fees / spread | Real-money phase only | Gated on legal path; **don't model now** |

If a paid currency ever exists, it is walled off entirely as cosmetic:
**money buys vanity, never position.** No buying market currency, ever —
equal stacks are load-bearing for leaderboard credibility.

---

# Part II — Analysis

## 7. The loops (why the mechanic retains)

**Daily loop:** open app → portfolio moved (news + trading + house baseline
mover) → check why (news feed, market screen) → adjust or hold → check
standing vs. rivals. Target: an interesting delta *every single day*, even
between race weekends.

**Event loop (race weekend, every ~2 weeks):** pre-race positioning →
live sentiment swings → post-race repricing → leaderboard reshuffle →
post-mortem content ("who called it").

**Season loop:** equal stacks at season start → compounding track record →
Endgame finale → settlement → permanent record on profile → re-issue,
fresh season, everyone gets a new shot. Season-scoping is the retention
reset: losers get a clean slate, winners get history.

**Social loop:** good calls → Rook Score rises → followers → audience
pressure → more considered trading → more content for followers. This is
the compounding asset. Copy-trading (later) turns it into distribution.

## 8. Cold-start analysis

The cold-start problem is: *a market with no traders has no prices, and no
prices means nothing to open the app for.* Rook's answer is a stack of four
mutually reinforcing choices:

1. **AMM (bonding curve)** — every asset always tradeable, live price from
   trade #1. No empty order book, no ghost town.
2. **House baseline mover** — overnight movement from news even when volume
   is thin. The "I opened the app and something happened" knob.
3. **Single dense league (F1)** — ~10 constructor assets means a few
   hundred users produce real per-asset depth. Density over breadth.
4. **Day-one leaderboards + seeded friend-group beta** — rivalry has bodies
   in it from hour one. Even at 300 users, "Top F1 Investor This Month" is
   a reason to come back.

Why F1 over EPL for launch: ~10 assets vs. 20 (denser per-asset activity),
global audience, dramatic two-week cadence, unambiguous performance
(finishing position). EPL is the bigger market — deeper news flow, huge
fanbase — and is vertical #2 once the mechanic is proven. Breadth is the
enemy at launch.

## 9. Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **House mover becomes de facto pricing** (breaks "prices nothing") | Critical | Directional-only, hard cap on share of any move, per-asset decay to zero with organic volume; prototype and tune before anything else is built |
| R2 | **Dead-market feel** (mover tuned too weak, thin trading) | High | Same knob, opposite failure; simulation in Phase 0 finds the band; closed beta validates feel |
| R3 | **Leaderboard manipulation** (pump groups, wash trades, multi-accounts) | High | Rook Score rewards risk-adjusted early-and-right, not raw return; wash-trade detection; account limits; season resets bound damage |
| R4 | **Rook Score formula rewards recklessness** | High | Treat the formula as core incentive design (see §14); beta-test against simulated strategies before launch |
| R5 | **Regulatory drift** (adding a redeemable currency or prize contests "just this once") | Critical | Hard scope fence (§18 non-goals); any real-money step is a deliberate, lawyer-led project, never a feature flag |
| R6 | **News-data cost/licensing** | Medium | v1 needs a news *feed*, not proprietary data; start with public/aggregated sources; price per-league data cost before EPL |
| R7 | **Category timing** (a funded competitor lands first) | Medium | Ship narrow and fast; community + reputation graph is the moat, not the mechanic |
| R8 | **Thin-market whipsaw** (steep curve + one whale = chaos) | Medium | Start with a flatter curve and tune up; whale activity is surfaced (transparency as fairness); per-trade size caps in v1 |
| R9 | **Season-end cliff** (engagement dies between seasons) | Medium | Off-season design in v2 notes (§26); v1 accepts the cliff — F1's calendar gap is short |

## 10. Fairness & transparency doctrine

"Fair" is the brand promise, so fairness must be *visible*:

- **Every price change is traceable to trades.** House-mover trades are
  logged and internally auditable from day one; the mechanism's existence
  and rules are publicly documented (a "how prices work" page). Disclosed
  mechanics are fair mechanics.
- **Whale activity is surfaced, not hidden.** If big money moves a price,
  everyone can see that it did.
- **Equal stacks, no top-ups.** The only way to have more is to trade
  better.
- **Rook never trades for advantage.** The house mover has no P&L
  objective; its budget is an explicit liquidity subsidy.

## 11. Regulatory analysis

**v1 posture: effectively zero exposure.** No cash-in to the market, no
cash-out, no redeemable currency, no paid-entry prize contests → legally a
video-game economy, not gambling. This is not timidity; it buys the freedom
to prove the mechanic while the legal landscape resolves itself.

**The core future hurdle:** if real money goes in and returns depend on
sporting outcomes, most US states classify it as sports wagering →
state-by-state gambling licenses. Every real-money path exists to get
around that wall.

**Landscape (as of mid-2026 — verify before relying):**

- The jurisdictional fight is CFTC-federal ("event contracts are swaps, one
  federal rulebook") vs. state gaming regulators ("it's gambling, 50
  rulebooks"). Unresolved; widely expected to reach the Supreme Court.
- April 2026: Third Circuit sided with the CFTC/Kalshi position (sports
  event contracts are swaps; federal preemption) — preliminary, binding in
  three states. Nevada, Maryland, Ohio courts have gone the other way;
  a circuit split is likely.
- June 2026: CFTC proposed a rule explicitly allowing sports event
  contracts — including **season-long performance metrics** and
  win/loss/standings outcomes — while disallowing single-play, injury, and
  officiating bets. Rook's season-scoped, standings-relative model sits
  close to the *permitted* category.
- Live counter-risk: a bipartisan bill ("Prediction Markets Are Gambling
  Act") would reclassify these as gambling and strip CFTC jurisdiction.

**Paths through (ranked):**

| Path | Mechanism | Assessment |
|------|-----------|------------|
| 1. Play-money game | No cash-out; monetize subscriptions/cosmetics/creator tools | **v1 answer.** Zero exposure |
| 2. Data / index licensing | Sell the measurement layer; no consumer wagering | Underrated; real revenue, no gambling nexus |
| 3. CFTC event-contract venue | Real-money via a regulated DCM (own or partner) | The Kalshi path: powerful if it holds, but ~$30M+, years, still litigated; binary $0/$1 instruments are structurally unlike a held Rook share |
| 4. Sweepstakes model | Dual currency, redeemable sweeps | Known on-ramp, rising state scrutiny; situational |
| 5. State gambling licenses | License as a sportsbook, state by state | Last resort; what every other path avoids |

**Sequence:** Path 1 now → Path 2 for early revenue → watch the CFTC rule
finalize and the split resolve → structure Path 3 deliberately, funded and
lawyer-led, if it lands. Decide real-money jurisdiction by where a legal
path can be *bought*, not where the market is biggest.

*This section reflects sources through June 2026 and is strategic analysis,
not legal advice.*

---

# Part III — Product architecture

## 12. Economy design

- **Starting stack:** every user receives the same play-money balance at
  season start — default **$10,000** play-dollars (display as `$`; the
  finance register is intentional). No purchases, no top-ups, no transfers
  between users.
- **Season scoping:** assets settle at season end and re-issue for the new
  season. Everyone re-receives the standard stack each season; career
  record and Rook Score persist across seasons.
- **Settlement value (decision H, recommended default):** settle each asset
  at the **time-weighted average market price over the final week** of the
  season (TWAP prevents last-minute manipulation). This keeps Rook pure
  sentiment end-to-end and regulatorily cleanest.
  *Alternative to evaluate in beta:* standings-anchored settlement (payout
  table by final constructor position) — sharpens the "being right"
  incentive but moves the instrument toward prediction-market territory;
  revisit with counsel before any real-money phase.

## 13. Market mechanics

### 13.1 AMM (bonding curve)

Baseline liquidity for every asset, always. Recommended v1 shape: a
**linear bonding curve** per asset — simple, auditable, easily explained on
the fairness page:

```
price(s) = p0 + m·s          s = circulating supply bought from the curve
buy cost (s → s+q)  = ∫ price = q·p0 + m·(s·q + q²/2)
sell proceeds       = same integral, reversed (sell back onto the curve)
```

- `p0` — identical base price for all assets at season start (no implied
  house ranking; the market discovers relative value from a flat start).
- `m` — curve steepness, **the tunable**: steeper = dramatic moves but
  thin-market whipsaw; flatter = calmer but sleepier. **Start flatter and
  tune up** in Phase 0 simulation.
- The curve's cash reserve is closed-loop: sell proceeds always covered by
  prior buy payments by construction.
- Per-trade size cap in v1 (anti-whipsaw, anti-whale-griefing); surfaced
  transparently.

**Order-book handoff is post-v1** (see §25). The trigger is **liquidity
depth, not user count**: an asset graduates when its hypothetical book
would actually fill.

### 13.2 House baseline mover

Purpose: portfolios move overnight on news even when trading is thin. This
is the single most dangerous knob in the product — too strong and Rook is
pricing teams; too weak and the app feels dead. Hard constraints (all
three, always):

1. **Directional-only.** News events map to a sign (+/−) per asset; the
   mover nudges *direction*, never chooses a target price.
2. **Capped.** The mover's contribution to any asset's price move over any
   window is hard-capped at a fraction `C` of the total move
   (starting point: `C ≤ 0.3`, tuned in Phase 0).
3. **Decaying.** Per-asset influence multiplier
   `δ(a) = max(0, 1 − V_organic(a)/V*)` — as an asset's organic volume
   approaches threshold `V*`, house influence goes to zero and price-setting
   is fully the traders'.

Mechanism sketch: a worker consumes classified news events
(`event → {asset, sign, magnitude-class}`), and executes small, capped,
flagged synthetic trades on the bonding curve in the event's direction,
scaled by `δ(a)` and rate-limited per window. Every house trade is logged
and distinguishable in the audit trail. The mover has **no P&L objective**;
it is an explicit, budgeted liquidity subsidy.

Tunables to settle in Phase 0: nudge size per event class, per-window rate
limits, cap `C`, decay threshold `V*`. Tune conservative — under-moving is
recoverable; over-moving breaks the constitution.

### 13.3 News ingestion

v1 needs a **real-time news feed for traders to react to** — not a
proprietary pricing feed. Requirements: F1 news aggregation (results,
quali, penalties, technical directives, driver-market moves, testing),
timestamped, tagged per asset, displayed in-app on the market screen and as
the "why did this move" context. The house mover consumes a
coarse-classified subset (sign + magnitude class only). Price per-league
news-data cost before committing to EPL (risk R6).

## 14. Rook Score (the game's incentive design)

Elo-style **market reputation** — explicitly *reputation*, not "good
trader." Scores the player, never the team. Per-league specialization
(star ratings per vertical once there are ≥2).

**Design constraint:** rewarding raw return alone incentivizes reckless
concentration and pump behavior. The formula must reward **being early and
being right**:

- **Risk-adjusted excess return** vs. the Rook Index (league-wide market
  average) over rolling windows — beating the market, adjusted for the
  volatility of what you held.
- **Earliness weighting** — profit on a position opened *before* the
  crowd's move outweighs profit from momentum-chasing after it.
- **Elo-style pairwise update** — each scoring window, users gain/lose
  rating relative to expectations set by their current rating (winning big
  as a Grandmaster moves you less than as a Rookie).
- **Anti-gaming:** volume-weighted so dust trades don't farm signal;
  wash-trade filtered; concentration beyond a threshold contributes at
  reduced weight.

All inputs are market-activity observables (positions, prices, timing,
flow) — the guardrail holds. The exact coefficients are a **Phase 0/beta
deliverable**: simulate strategy archetypes (diversified early buyer,
reckless concentrator, momentum chaser, wash trader) and verify the ranking
orders them the way the product intends.

**Rank ladder (proposal):** Rookie → Club Player → Candidate → Expert →
Master → **Grandmaster** (top percentile, not fixed threshold). New users
start mid-ladder-bottom with a provisional badge.

## 15. The measurement layer (the Bloomberg surface)

Every metric passes one test: *computable from market activity alone,
never from sporting prediction.* "Confidence" always means
confidence-of-the-market (order-flow conviction), never
confidence-in-the-team (form/fixtures/injuries).

| Metric | Definition (v1) | Guardrail check |
|--------|-----------------|-----------------|
| Price | AMM spot price | Market-set ✓ |
| Momentum | EMA of signed net flow (buys − sells) | Observes trading ✓ |
| Volume | Rolling 24h / 7d traded value | ✓ |
| Volatility | Stdev of returns over rolling window | ✓ |
| Ownership distribution | Share held by top 1% / 10% of holders; holder count | ✓ |
| Whale activity | Trades above N% of the asset's daily volume, surfaced | ✓ |
| Returns | 24h / 7d / season | ✓ |
| League-relative strength | Asset return minus Rook Index return | ✓ |
| Market conviction | Buy/sell order-flow imbalance | Confidence-of-the-market ✓ |
| Rook Index | Cap-weighted league-wide price index | ✓ |

This layer is simultaneously: the reason a bare price is worth staring at,
the future premium paywall, and the future licensable data asset.

---

# Part IV — Phases

## 16. Phase 0 — Prototype the math (≈ weeks 1–3)

Everything sits on the AMM + house-mover math; it's the riskiest piece, so
it goes first, before any product code.

**Build:** a simulation harness (notebook or small TypeScript/Python
package — same language as the eventual engine so the code transfers).
Simulate: N agents with strategy archetypes, news-event streams,
curve steepness sweeps, mover cap/decay sweeps, whale scenarios,
season-length runs. Also: first-cut Rook Score, scored against the
archetypes.

**Exit criteria:**
- A curve steepness band where thin markets (≈50 actives) neither flatline
  nor whipsaw.
- Mover parameters where (a) every news day produces visible portfolio
  movement, (b) house share of any move stays under cap, (c) house
  influence measurably → 0 as organic volume rises.
- Rook Score ranks the strategy archetypes correctly (early-and-right >
  momentum chaser > reckless concentrator; wash trader ≈ bottom).
- All parameters written down as the v1 config (see §20).

## 17. Phase 1 — Build v1 (≈ weeks 3–8)

The three screens against F1, powered by the Phase-0-validated engine.
Full build instructions in Part V. **Exit:** internal dogfood — the team
runs a fake half-season end-to-end (news → moves → trades → scores →
leaderboard) without manual intervention.

## 18. Phase 2 — Closed beta (≈ weeks 8–12)

- Seed with a **real friend-group** (50–300 users) so the rivalry layer has
  bodies in it from hour one; seed leaderboards before opening the doors.
- Mid-season entry is fine (equal stack on join; provisional Rook Score).
- Instrument the daily-open loop obsessively (metrics in §22).
- Run at least one full race cycle — ideally three — before widening.

**Scope fence (what v1 is deliberately NOT):** no cash-out, no redeemable
second currency, no paid-entry prize contests, no real-money anything, no
buying currency or position ever, no copy-trading (follow only), no order
book, no second league, no metric requiring sporting prediction. Anything
that breaches the fence is a *phase decision*, not a feature request.

**Exit criteria (directional targets, calibrate in beta):**
- ≥40% of weekly actives open on a **non-race day** (the loop works
  without the sport carrying it).
- D7 retention ≥ 35% for friend-graph-connected users.
- Median actives check the leaderboard ≥ 2×/week.
- No unresolved fairness incident (mover overreach, manipulation win).

## 19. Phase 3 — Narrow public launch (v1)

- Lean on the **"fantasy stock market for sports"** narrative while the
  prediction-market category is hot; position against the sportsbook
  aesthetic explicitly.
- Launch assets: F1 constructors only. Waitlist + invite mechanics preserve
  friend-graph density as it grows.
- Publish the fairness page (how prices work, the mover's rules, equal
  stacks) at launch — transparency is positioning.

**Then, in order** (each gated on the previous proving out):
**v1.5** — premium analytics tier + cosmetics; EPL vertical once per-league
news cost is known. **v2** — order-book handoff for high-volume assets;
copy-trading + creator revenue share. **Long-term** — data licensing
revenue; the real-money question, funded and lawyer-led (Part VI).

---

# Part V — v1 build instructions

## 20. Recommended stack & repo layout

Defaults chosen for one-or-two-builder speed; swap freely if conviction
differs.

- **TypeScript monorepo** (pnpm workspaces).
- **Web-first PWA** (Next.js, dark theme only) — fastest path to a closed
  beta on phones without app-store friction; native app is a v1.5+ call.
- **Postgres** as the system of record. **The trade engine is a
  single-writer service per asset** (serializable transaction or per-asset
  queue) — an AMM is a shared counter; correctness beats cleverness.
- **Background workers** (same codebase): news ingestion/classification,
  house-mover ticks, price snapshots, score recomputation.
- Hosting: anything boring (Vercel/Fly/Railway + managed Postgres).

```
rook/
  apps/web/            # Next.js: the three screens
  packages/engine/     # AMM math, mover logic, Rook Score — pure, tested, simulation-shared
  packages/db/         # schema + migrations
  workers/             # news ingest, mover tick, snapshots, scoring
  sim/                 # Phase 0 harness (imports packages/engine)
  docs/
```

The **engine package is pure and deterministic** (no I/O): the same code
runs in the Phase 0 simulator, the server, and tests. This is what makes
the dangerous knobs tunable with confidence.

## 21. Data model (core tables)

| Table | Key fields | Notes |
|-------|-----------|-------|
| `users` | id, handle, created_at | Handles are identity; profanity/impersonation checks |
| `seasons` | id, league, starts_at, ends_at, status | Season-scoped everything hangs off this |
| `assets` | id, season_id, name, p0, m, supply, reserve | One row per constructor per season |
| `balances` | user_id, season_id, cash | Starting stack seeded on join |
| `holdings` | user_id, asset_id, qty, avg_cost | |
| `trades` | id, asset_id, actor (user \| **house**), side, qty, price_before/after, cash_delta, ts | Append-only; the audit trail. House trades flagged |
| `price_points` | asset_id, ts, price, volume | Snapshots for charts/metrics |
| `news_events` | id, ts, headline, source, asset_tags, sign, magnitude_class | Display feed + mover input |
| `mover_log` | event_id, asset_id, qty, δ_at_time, cap_check | The mover's public conscience |
| `scores` | user_id, season_id, rook_score, window_stats | Recomputed per scoring window |
| `follows` | follower_id, followee_id, ts | The social graph |
| `config` | key, value, effective_at | Every tunable versioned (curve m, cap C, V*, event nudges…) |

Non-functional requirements: every price change reconstructible from
`trades`; all tunables in versioned `config`, never hardcoded; rate limits
per user per asset per window; soft-delete nothing in `trades`.

## 22. API surface (v1)

```
POST /auth/*                      # magic-link or OAuth; keep it minimal
GET  /portfolio                   # holdings, movers, returns, rook score
GET  /assets                      # list with prices + headline metrics
GET  /assets/:id                  # price history, measurement layer, news
POST /assets/:id/trade            # {side, qty} → engine (validated, capped)
GET  /leaderboard?window=...      # season / monthly / weekly
GET  /traders/:handle             # public profile: holdings, returns, followers
POST /traders/:handle/follow
GET  /news?asset=...
GET  /fairness                    # static: how prices work, mover rules
```

Trade execution flow: validate (balance, size cap, rate limit) → per-asset
lock → engine computes cost/proceeds from curve → write `trades` +
`holdings` + `balances` atomically → emit price point. Mover trades follow
the identical path with `actor = house`.

**Instrumentation from day one** (the beta lives or dies on these):
daily-open rate, non-race-day open rate, trades per weekly active,
leaderboard views per session, follow-graph density, D1/D7/D30,
house-share-of-move per asset per day (the R1 dashboard).

## 23. The three screens (build spec)

Everything else is scope you can cut. These three are the product. The
acceptance test for all of them: **a new user can answer "what does my
season look like, and who am I beating" in their first session.**

### 23.1 Portfolio (home) — the daily-open screen
- Header: total value, season return ($ and %), sparkline.
- Rook Score + rank badge (Rookie → Grandmaster), tap → own profile.
- Holdings list: asset, qty, value, day change (▲/▼), season change.
- "Today's movers" strip: biggest movers in the league with the headline
  that moved them.
- Empty state (new user) is a *starter flow*: equal stack, pick your first
  positions — first session must end with a portfolio.

### 23.2 Market (a team) — the Bloomberg surface
- Price + chart (1D / 1W / 1M / season).
- Measurement layer: momentum, volume, volatility, ownership distribution,
  whale activity, 7-day and season return, league-relative strength,
  market conviction (§15).
- News feed filtered to this asset — the "why it moved" context.
- **Buy / Sell: plain buttons, plain finance verbs.** Trade sheet shows
  curve-quoted cost/proceeds *before* confirm (no surprise pricing —
  fairness doctrine).

### 23.3 Leaderboard + trader profiles — reputation from day one
- Rankings: season / monthly / weekly; league-scoped. "Top F1 Investor
  This Month" is a headline, not a table row.
- Tappable profiles: Rook Score + rank, season return, holdings (public by
  default — transparency is the culture; revisit privacy post-beta),
  followers/following, career record (per-season history).
- Follow button. **No copy-trading in v1.**

## 24. v1 build checklist (ordered)

1. Phase 0 sim harness in `packages/engine` + `sim/` — exit criteria of §16
2. Config system + schema + migrations (§21)
3. Trade engine service + `/trade` path, fully tested against engine
4. News ingest worker (F1 sources, tagging, sign classification)
5. House mover worker + `mover_log` + R1 dashboard
6. Price snapshots + measurement-layer computations
7. Rook Score worker (Phase 0 formula) + rank ladder
8. Screen 1: Portfolio (incl. starter flow)
9. Screen 2: Market + trade sheet
10. Screen 3: Leaderboard + profiles + follow
11. Fairness page; instrumentation events (§22)
12. Season lifecycle jobs: open, snapshot, settle (TWAP), re-issue
13. Seed + closed beta (§18)

---

# Part VI — Background notes for later versions

Recorded now so later decisions start from context, not memory. None of
this is v1 scope.

## 25. v1.5–v2 — breadth and depth

**EPL (vertical #2).** Gate: mechanic proven in F1 *and* per-league
news-data cost known (R6). 20 assets, weekly cadence, far deeper news flow
(transfers, managers, injuries — richer trader fodder, thinner per-asset
liquidity early). Per-league Rook Score stars activate here. Expect the
mover to matter longer per-asset (20 assets dilute volume).

**Order-book handoff (per-asset).** Trigger by liquidity depth, not user
count: an asset graduates when a book would actually fill (e.g., sustained
two-sided flow such that top-of-book spread < AMM slippage for the median
trade size). Hybrid mechanics: AMM stays as backstop liquidity
(book-first routing with curve fallback) so the no-ghost-town guarantee
survives graduation. Grandfather open positions untouched; graduation is a
routing change, not an instrument change.

**Copy-trading (fast-follow, deliberately not v1).** Strongest
identity/virality mechanic (eToro precedent) — and real product surface
plus real *future liability*: in any real-money world you are routing
followers' capital on a leader's calls. Prereqs: reputation dynamics
proven; manipulation surface understood (copy-farming, front-running
followers); design leader incentives as revenue-share on
subscription/cosmetics, never on volume. Follow-graph data from v1 tells
you who would be copied — mine it before building.

**Premium analytics tier.** Free tier keeps everything needed for the core
loop (price, basic returns, leaderboard). Pro tier ("Opening Book"):
deeper history, ownership/whale detail, conviction analytics, export.
Rule: **paywall depth of sight, never fairness of play** — nothing paid
may confer trading advantage that breaks the equal-footing promise; if a
metric proves decisive for returns, it migrates to free.

**Cosmetics & identity goods.** Profile flair, portfolio themes, rank
plumage. Strictly cosmetic; never position, never currency.

**Native apps.** Post-PWA validation. The daily-open loop wants a home
screen icon and push ("your portfolio moved") — push notifications are
likely the single highest-leverage v1.5 feature for the loop.

## 26. Open product questions parked for later

- **Off-season design (R9):** F1's gap is short, but EPL summer is long.
  Options: off-season exhibition markets (silly-season driver-move
  sentiment), historical replays, cross-league Rook Index products.
  Decide after one full season of retention data.
- **Mid-season joiner fairness:** equal stack mid-season is fine for v1;
  at scale consider season-cohort leaderboards ("Late Entry" board) so
  Endgame boards aren't diluted.
- **Privacy of holdings:** public-by-default is the v1 culture bet;
  revisit if it chills trading among beta users.
- **Settlement anchor (decision H):** revisit TWAP-vs-standings settlement
  with beta data — and with counsel before any real-money phase, since the
  answer changes the instrument's regulatory character.
- **Handle/domain follow-through:** confirm rook.com's owner is a parked
  page (not a live product) before any brand spend that assumes eventual
  acquisition; register @rookhq-style handles across platforms now.

## 27. Long-term — the real-money question and the data asset

**Data/index licensing (likely first real revenue).** The measurement
layer — indices, volatility, sentiment, price discovery — is a genuine
data asset potentially licensable to media, sponsors, and analytics firms
*before* any real-money trading. The CFTC itself has cited exactly these
"price discovery" and "commercial forecasting" uses as the public-interest
justification for sports event contracts. Productize as: Rook Index feeds,
per-team sentiment series, market-moment detection for broadcast graphics.

**Real money is a legal structure, not a feature flag.** Decision inputs
to watch: final CFTC rule text (does season-long/standings stay in the
permitted category?); circuit-split resolution or SCOTUS; the "Prediction
Markets Are Gambling Act" outcome. If the federal path holds, Rook's
season-scoped standings-relative model is well-positioned within the
permitted category — but the instrument shape (continuous held shares vs.
binary $0/$1 contracts) needs deliberate design work with counsel, and the
jurisdiction gets chosen by **where a legal path can be bought, not where
the market is biggest**.

**North star (unchanged at every phase):** hold for years, watch it
profit, build a reputation. Stability, not churn. Rook shouldn't be
right. Rook should be fair.

---

*Regulatory content reflects sources dated through June 2026 and is a
fast-moving area — confirm current status before legal or financial
decisions. This document is strategic analysis, not legal advice.*
