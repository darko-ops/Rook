-- Phase 3 (narrow public launch): waitlist, invite quotas, magic-link auth.

create table waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  referred_by text, -- handle of the referrer, if any
  created_at timestamptz not null default now(),
  invited_at timestamptz,
  invite_code text references invites(code)
);

-- per-user invite grants: remaining = invite_quota − invites minted by user
alter table users add column invite_quota int not null default 0;
alter table users add column email text unique;

-- magic-link tokens (auth.magicLink config gates the flow)
create table auth_tokens (
  token text primary key,
  email text not null,
  handle text not null,
  invite_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
