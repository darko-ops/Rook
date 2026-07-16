-- Real constructor standings: displayed as market context (the Opening Book
-- angle) and used to derive classified race-result events for the mover.
-- Rook never prices from these — traders do.

create table standings (
  season_id bigint not null references seasons(id),
  asset_id bigint not null references assets(id),
  round int not null,
  position int not null,
  points numeric not null,
  wins int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, asset_id)
);
