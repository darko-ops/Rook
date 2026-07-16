-- Driver assets alongside constructors: same curve, same season, same
-- mechanics — a second asset class, not a second system.

alter table assets add column kind text not null default 'team'
  check (kind in ('team', 'driver'));
alter table assets add column team_symbol text;
