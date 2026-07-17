# Phase 6 — The Data Asset (§27)

The measurement layer productized: "likely first real revenue," with no
gambling nexus. Everything derives from the disclosed audit trail —
licensing sells the lens and the pipes, never an information edge over
Rook's own traders (§25's rule, applied outward).

## What ships

- **Rook Index** — cap-weighted average price relative to the flat start
  (100 = league at p0), snapshotted hourly by the worker, displayed on the
  Market screen. Note the definition choice: normalizing to raw market cap
  is wrong for a bonding-curve market because cap growth conflates price
  with deployment; supply-weighted average price is the honest "league
  price level."
- **Market moments** — hourly detector for material moves (±2%/1h,
  ±5%/24h), deduped, attributed to the nearest same-direction classified
  headline (else "market flow"). The broadcast-graphics feed.
- **Licensed API v1** (`x-rook-key` header, per-key daily limits, usage
  logged to the events table):

| Endpoint | Feed |
|----------|------|
| `GET /api/data/v1/index?days=N` | Rook Index series |
| `GET /api/data/v1/assets` | catalog: prices, returns, volumes, standings |
| `GET /api/data/v1/assets/:symbol/series?days=N` | hourly prices + daily sentiment (net flow, volume, buy share) |
| `GET /api/data/v1/moments` | significant moves with attribution |

- **`/data`** — public pitch page with live index and moment samples.
- Ops: `beta data-key <name> [dailyLimit]` mints keys;
  `beta index-backfill` rebuilds history from price snapshots.

## Positioning

The CFTC itself cites price discovery and commercial forecasting as the
public-interest justification for event markets — Rook Data is that story
with an API attached: fan sentiment as market data for media, sponsors,
and analytics firms. No odds, no predictions, no wagering product.

## Not in scope, still

Real money remains a legal structure, not a feature flag (§27): the
decision inputs are the final CFTC rule text, the circuit split, and the
"Prediction Markets Are Gambling Act" — a funded, lawyer-led project when
its time comes. EPL remains gated on proving the F1 mechanic with real
humans first; the platform underneath (leagues on `seasons.league`,
pluggable news sources, generic assets/standings) is already
multi-league-shaped.
