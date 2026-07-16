-- v1.5: premium analytics (Opening Book), cosmetics, web push.
-- Monetization rule (§25): money buys depth of sight and vanity — never
-- position, never fairness of play.

alter table users add column plan text not null default 'free'
  check (plan in ('free', 'pro'));
alter table users add column flair text; -- strictly cosmetic

create table push_subscriptions (
  endpoint text primary key,
  user_id bigint not null references users(id),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_notified_at timestamptz
);
create index push_user on push_subscriptions (user_id);
