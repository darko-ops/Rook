# Rook — v1 Product Spec

> **Own the season.**
>
> Rook is a play-money exchange where fans build portfolios of sports teams,
> watch them move on real-world news, and climb a reputation ranking against
> their friends. Dark, minimal, and unmistakably **not** a sportsbook.

**One line to keep on the wall:** *Rook shouldn't be right. Rook should be fair.*

**Status:** Draft v1 spec · Derived from the Product Breakdown & Strategy doc (July 2026)

---

## 1. What v1 is, in one sentence

A play-money exchange for **one sports league (F1)**, where fans build a
portfolio, watch it move on real-world news, and climb a reputation ranking
against their friends.

### The one test for every v1 decision

> If a new user can't answer **"what does my season look like, and who am I
> beating"** within their first session, the feature you're building isn't v1.

That question *is* the product. Everything that serves it ships; everything
that doesn't waits.

---

## 2. Product principles (load-bearing, non-negotiable)

1. **Rook prices nothing; it measures everything.** The market sets price via
   pure sentiment on an AMM. The algorithm never sets a price. Rook computes
   everything *except* value: momentum, volume, volatility, ownership
   distribution, whale activity, returns, league-relative strength.
2. **Every metric must be computable from market activity alone — never from
   sporting prediction.** Momentum, volume, ownership are fine (they observe
   trading). Any "confidence" metric must mean *confidence-of-the-market*
   (order-flow conviction), never *confidence-in-the-team* (form, fixtures,
   injuries). The moment a metric needs Rook to predict whether a team will
   perform, it has become valuation in disguise — cut it.
3. **Equal starting balance for everyone.** Every user starts with the same
   play-money stack. This makes Rook Score measure *skill, not spend*, which
   keeps the leaderboard credible, which is the entire retention engine.
   **No buying market currency, ever.**
4. **Play-money only. No cash-out.** This is the moat around regulatory
   exposure while the mechanic is proven — not timidity, not a product
   limitation.
5. **Rook is a venue, not an oracle.** Users are the investors; Rook is the
   exchange. The scoring system scores the *player*, never the team.
6. **Aesthetic: dark, minimal, financial-instrument.** Apple Stocks /
   Robinhood / Linear / F1. No casino green. Opening Rook must feel like
   opening a trading app, not a betting slip. Buy/Sell are plain finance
   verbs; chess vocabulary lives in status/flavor, never in actions.

---

## 3. Launch scope

### One league: Formula 1

- **~10 constructor assets.** Density over breadth: a small asset set means
  the market feels alive even with a few hundred users.
- **Two-week race cadence** gives a natural rhythm of events for traders to
  react to.
- **Finishing position** is clean, unambiguous performance.
- EPL is vertical #2 once the mechanic is proven (v1.5–2). Breadth is the
  enemy at launch; density is the friend.

### Asset model: season-scoped

- Assets settle at season end and re-issue each new season.
- The season is the narrative arc; "what does my season look like" is the
  frame for everything.

### Data need

- A **real-time news feed** for traders to react to — *not* a real-time
  pricing algorithm. News moves traders; traders move price.

---

## 4. Core market mechanics

### 4.1 AMM (bonding curve) — baseline liquidity

Every asset is always tradeable with no counterparty needed — no empty order
book, no ghost town.

- **Architecture:** AMM-first hybrid. Bonding curve provides baseline
  liquidity; an order book takes over **per-asset** once real volume
  justifies it (post-v1).
- **Curve steepness (tunable):** steeper = more dramatic price moves
  (exciting, but thin-market whipsaw); flatter = calmer but sleepier.
  **Default: start flatter and tune up.**
- **Order-book handoff threshold (post-v1):** set by *liquidity depth*, not
  user count — an asset is ready for an order book when its book would
  actually fill.

### 4.2 House baseline mover — the overnight-movement knob

Makes portfolios move overnight on news so the app never feels dead when
thin. It is also **the single most dangerous knob**: too strong and Rook is
effectively pricing teams (breaks "prices nothing"); too weak and the app
feels dead.

Hard constraints (all three, always):

1. **Directional-only** — nudges the *sign* of a move, never the magnitude.
2. **Capped** — its share of any price move has a hard ceiling.
3. **Decaying** — its influence decays toward zero **per-asset** as that
   asset's organic volume rises, handing price-setting fully back to traders.

Tunables to settle during prototyping: nudge size per event type, and the
decay schedule. Tune conservatively.

### 4.3 Rook Score — reputation, and the game's incentive design

- **Elo-style market reputation** — explicitly *reputation*, not "good
  trader." Per-league specialization (star ratings). Scores the player,
  never the team.
- **Formula direction (to be settled during prototyping):** rewarding raw
  return alone incentivizes reckless concentration and pump behavior.
  Reward **being early and being right** — buying before a move,
  risk-adjusted returns — to make skill legible and discourage manipulation.
- This formula **is** the game's incentive design. Treat it as core
  mechanics, not cosmetics.

---

## 5. The three screens that are actually v1

Everything else is scope you can cut. These three are the product.

### 5.1 Portfolio (home) — the daily-open screen

- Your holdings, your movers, your return, your Rook Score.
- Dark Stocks/Linear aesthetic. Has to feel like opening a trading app.
- This screen answers "what does my season look like" at a glance.

### 5.2 Market (a team) — the Bloomberg surface

- **Price**, plus the measurement layer around it: momentum, volume,
  ownership distribution, whale activity, 7-day and season return,
  league-relative strength.
- This is what makes a bare price worth staring at — and it's the future
  paywall (premium analytics).
- **Buy/Sell are plain buttons.** Plain finance verbs; chess vocabulary
  lives in status, not actions.

### 5.3 Leaderboard + trader profiles — reputation from day one

- Rankings, and tappable profiles showing holdings, returns, followers.
- Even at 300 users, "Top F1 Investor This Month" is a reason to come back.
- **Follow and public profiles ship in v1.** Copy-trading waits — it's the
  strongest virality mechanic but adds surface and future liability
  (fast-follow, not v1).
- This screen answers "who am I beating."

---

## 6. Monetization (without distorting the market)

Charge for **seeing more** and **being more** — never for having more buying
power:

- **Premium analytics subscription** — the measurement layer is the natural
  paywall (deeper metrics, deeper history).
- **Cosmetics / profile flair.**
- **Extra portfolios.**

If a paid currency exists at all, it is walled off entirely as cosmetic:
money buys vanity, never position. Trading-fee revenue is a phase-2 thing
gated on the real-money legal path — **don't model it now**. Data/index
licensing of the measurement layer is the underrated early-revenue line
(no gambling nexus; the CFTC itself cites this "price discovery" use as
legitimate).

---

## 7. What v1 deliberately is NOT

- ❌ No cash-out
- ❌ No redeemable second currency
- ❌ No paid-entry prize contests
- ❌ No real-money anything
- ❌ No buying market currency or buying position, ever
- ❌ No copy-trading (follow only; copy is fast-follow)
- ❌ No order book (AMM only; per-asset handoff comes later)
- ❌ No second league (EPL is vertical #2, after the mechanic is proven)
- ❌ No metric that requires predicting sporting outcomes

This buys **zero regulatory exposure** while the mechanic is proven, and
lets Rook ride the prediction-market news wave as marketing instead of
being the news.

---

## 8. Ship sequence

1. **Prototype the AMM + house-mover math first.** It's the riskiest piece
   and everything sits on it.
2. **Build the three screens** against F1.
3. **Seed leaderboards and run a closed beta** with a real friend-group so
   the rivalry layer has bodies in it from hour one.
4. **Launch narrow.** Lean on the "fantasy stock market for sports"
   narrative while the category is hot.
5. **Then breadth (EPL), then depth** (order book, copy-trading, premium
   tier).

### The highest-leverage thing to get right

The **daily-open loop**: *portfolio moved + reputation at stake*. That's the
difference between a clever demo and something people open on a Tuesday.

---

## 9. Open decisions (with recommended defaults)

| # | Decision | Recommended default | Settle by |
|---|----------|--------------------|-----------|
| A | Bonding-curve steepness & order-book handoff threshold | Start flatter, tune up; handoff by liquidity depth, not user count | AMM prototype |
| B | House-mover nudge size & decay schedule | Directional-only, hard-capped share of any move, per-asset decay to zero; tune conservative | AMM prototype |
| C | Launch vertical | **F1** (safer cold start); EPL as vertical #2 | Decided for v1 |
| D | Rook Score formula | Reward early-and-right + risk-adjusted return, not raw return | Closed beta |
| E | Copy-trading | Out of v1; follow + public profiles in | Decided for v1 |
| F | Monetization mix | Subscription (analytics) + cosmetics; no trading fees in v1 | Post-beta |
| G | Handle/domain | Buy rook.ai; align handle (e.g. @rookhq) everywhere; verify rook.com is parked before brand spend | Pre-launch |

---

## 10. Regulatory posture (v1)

v1 has effectively **zero regulatory exposure** because there is no
cash-out — legally a video-game economy, not gambling. The real-money
question is a long-term, funded, lawyer-led decision (CFTC event-contract
path vs. alternatives), not a feature flag. The landscape is fast-moving
(sources through June 2026) — verify current status before any legal or
financial decision. This spec is strategic analysis, not legal advice.

---

## 11. North star

**Hold for years, watch it profit, build a reputation.** Stability, not
churn. The job isn't to predict sports — it's to build the fairest, most
engaging market where people express conviction and build reputation.
