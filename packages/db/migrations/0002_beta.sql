-- Phase 2 (closed beta): race calendar, invite gating, news dedup.

create table races (
  id bigint generated always as identity primary key,
  season_id bigint not null references seasons(id),
  round int not null,
  name text not null,
  quali_at timestamptz not null,
  race_at timestamptz not null,
  unique (season_id, round)
);
create index races_race_at on races (race_at);

create table invites (
  code text primary key,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  used_by bigint references users(id),
  used_at timestamptz
);

-- real news sources re-deliver items; dedup on url
create unique index news_events_url_unique on news_events (url) where url is not null;
