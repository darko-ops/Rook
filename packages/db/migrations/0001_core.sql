-- §21 core tables. Non-functional requirements: every price change
-- reconstructible from trades; tunables versioned in config; nothing in
-- trades is ever deleted.

create table users (
  id bigint generated always as identity primary key,
  handle text not null unique check (handle ~ '^[a-z0-9_]{2,20}$'),
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  user_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table seasons (
  id bigint generated always as identity primary key,
  league text not null,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('pending', 'open', 'settled')),
  unique (league, name)
);

create table assets (
  id bigint generated always as identity primary key,
  season_id bigint not null references seasons(id),
  symbol text not null,
  name text not null,
  color text not null default '#888888',
  p0 numeric not null,
  m numeric not null,
  supply numeric not null default 0,
  reserve numeric not null default 0,
  settled_price numeric,
  unique (season_id, symbol)
);

create table balances (
  user_id bigint not null references users(id),
  season_id bigint not null references seasons(id),
  cash numeric not null,
  joined_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

create table holdings (
  user_id bigint not null references users(id),
  asset_id bigint not null references assets(id),
  qty numeric not null default 0 check (qty >= 0),
  avg_cost numeric not null default 0,
  primary key (user_id, asset_id)
);

-- Append-only audit trail. actor='house' rows are the mover's trades.
create table trades (
  id bigint generated always as identity primary key,
  asset_id bigint not null references assets(id),
  actor text not null check (actor in ('user', 'house')),
  user_id bigint references users(id),
  side text not null check (side in ('buy', 'sell')),
  qty numeric not null check (qty > 0),
  cash_delta numeric not null,
  price_before numeric not null,
  price_after numeric not null,
  ts timestamptz not null,
  check ((actor = 'user') = (user_id is not null))
);
create index trades_asset_ts on trades (asset_id, ts);
create index trades_user_ts on trades (user_id, ts) where user_id is not null;

create table price_points (
  asset_id bigint not null references assets(id),
  ts timestamptz not null,
  price numeric not null,
  supply numeric not null default 0,
  volume_24h numeric not null default 0,
  primary key (asset_id, ts)
);

create table news_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null,
  headline text not null,
  source text not null,
  url text,
  asset_id bigint references assets(id),
  sign int check (sign in (-1, 1)),
  magnitude text check (magnitude in ('small', 'medium', 'large')),
  processed_by_mover boolean not null default false
);
create index news_asset_ts on news_events (asset_id, ts);
create index news_unprocessed on news_events (id) where not processed_by_mover;

-- The mover's public conscience: one row per decision, executed or not.
create table mover_log (
  id bigint generated always as identity primary key,
  news_event_id bigint not null references news_events(id),
  asset_id bigint not null references assets(id),
  ts timestamptz not null,
  executed boolean not null,
  reason text not null,
  qty numeric not null,
  notional numeric not null,
  delta numeric not null,
  trade_id bigint references trades(id)
);

create table scores (
  user_id bigint not null references users(id),
  season_id bigint not null references seasons(id),
  rook_score numeric not null,
  windows_played int not null default 0,
  window_stats jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

create table follows (
  follower_id bigint not null references users(id),
  followee_id bigint not null references users(id),
  ts timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- Every tunable, versioned; the engine only reads the latest effective row.
create table config (
  key text not null,
  value jsonb not null,
  effective_at timestamptz not null default now(),
  primary key (key, effective_at)
);

-- Scoring worker bookkeeping: which weekly windows have been folded into
-- ratings (scores table holds the current rating; this makes reruns idempotent).
create table score_windows (
  season_id bigint not null references seasons(id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  scored_at timestamptz not null default now(),
  primary key (season_id, window_start)
);

-- Instrumentation events (§22): daily-open, trades, leaderboard views…
create table events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  user_id bigint references users(id),
  kind text not null,
  props jsonb not null default '{}'
);
create index events_kind_ts on events (kind, ts);
