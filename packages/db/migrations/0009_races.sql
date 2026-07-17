-- Race detail & history: schedule enrichment + results from the live API.

alter table races add column circuit text;
alter table races add column locality text;
alter table races add column country text;
alter table races add column results jsonb; -- top 10, null until completed
alter table races add column synced_at timestamptz;
