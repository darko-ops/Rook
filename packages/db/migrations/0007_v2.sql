-- v2: order book (hybrid with the AMM backstop) and copy-trading.

create table orders (
  id bigint generated always as identity primary key,
  asset_id bigint not null references assets(id),
  user_id bigint not null references users(id),
  side text not null check (side in ('buy', 'sell')),
  limit_price numeric not null check (limit_price > 0),
  qty numeric not null check (qty > 0),
  remaining numeric not null,
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  created_at timestamptz not null default now()
);
create index orders_book on orders (asset_id, side, limit_price) where status = 'open';
create index orders_user on orders (user_id) where status = 'open';

-- book fills leave supply untouched; only 'curve' rows reconstruct supply
alter table trades add column venue text not null default 'curve'
  check (venue in ('curve', 'book'));
-- copied trades carry their provenance (audit; also the cascade guard)
alter table trades add column copied_from bigint references trades(id);
-- maker rows are passive fills: excluded from taker rate limits
alter table trades add column maker boolean not null default false;

create table copy_follows (
  follower_id bigint not null references users(id),
  leader_id bigint not null references users(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (follower_id, leader_id),
  check (follower_id <> leader_id)
);

-- copy engine cursor: last leader trade replicated
create table copy_cursor (
  season_id bigint primary key references seasons(id),
  last_trade_id bigint not null default 0
);
