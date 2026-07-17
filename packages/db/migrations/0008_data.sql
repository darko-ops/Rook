-- Phase 6: the data asset (§27) — Rook Index, market moments, licensed API.

create table index_points (
  season_id bigint not null references seasons(id),
  ts timestamptz not null,
  market_cap numeric not null,
  value numeric not null, -- normalized: 100.0 at season open
  primary key (season_id, ts)
);

-- market-moment detection: significant moves with their attribution
create table moments (
  id bigint generated always as identity primary key,
  asset_id bigint not null references assets(id),
  ts timestamptz not null,
  window_hours int not null,
  ret numeric not null,
  price numeric not null,
  headline text, -- nearest classified news, if any ('market flow' otherwise)
  news_event_id bigint references news_events(id)
);
create index moments_ts on moments (ts desc);
-- ts is hour-truncated by the detector, so plain uniqueness dedups
create unique index moments_dedup on moments (asset_id, window_hours, ts);

-- licensed data API keys
create table api_keys (
  key text primary key,
  name text not null,
  daily_limit int not null default 1000,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
