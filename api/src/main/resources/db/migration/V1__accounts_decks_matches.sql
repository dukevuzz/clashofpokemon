-- The whole schema, in one migration, because it is the first one and there is
-- no history to preserve yet. Everything after this is additive.

-- ─────────────────────────────────────────────────────────────── account
-- A guest and a registered player are the same row. Signing up binds
-- credentials to an id that already has a history rather than starting a new
-- one -- which is the whole reason guests are accounts and not a separate idea.
create table account (
  id             text primary key,
  display_name   text not null unique,
  guest          boolean not null default true,
  email          text unique,
  password_hash  text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  wins           integer not null default 0,
  losses         integer not null default 0,
  draws          integer not null default 0,
  banned_until   timestamptz
);

-- Guests that never played are noise. This is the index the reaper walks; it
-- is partial so it stays small however many real accounts exist.
create index account_reap_idx on account (created_at)
  where guest and wins = 0 and losses = 0 and draws = 0;

-- ────────────────────────────────────────────────────── external_identity
-- A table rather than a column on account, for two reasons: a person may link
-- more than one provider, and the unique key here is what makes "already
-- linked" a database answer instead of a race between two link requests.
create table external_identity (
  provider    text not null,
  subject     text not null,
  account_id  text not null references account(id) on delete cascade,
  linked_at   timestamptz not null default now(),
  primary key (provider, subject)
);
create index external_identity_account_idx on external_identity (account_id);

-- ──────────────────────────────────────────────────────────── refresh_token
-- Rotated on every use. The hash rather than the token, so a database dump
-- does not hand out sessions. `replaced_by` is what makes theft detectable: a
-- token presented after it was rotated means two clients hold it.
create table refresh_token (
  id           bigserial primary key,
  account_id   text not null references account(id) on delete cascade,
  token_hash   text not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  replaced_by  bigint references refresh_token(id),
  revoked      boolean not null default false
);
create index refresh_token_account_idx on refresh_token (account_id)
  where not revoked;

-- ─────────────────────────────────────────────────────────────────── deck
-- Keyed by (account, slot) rather than columns on account: a second loadout
-- arrives within a month of launch, and a nullable column set does not survive
-- that. One row per deck costs nothing now and removes the migration later.
create table deck (
  account_id  text not null references account(id) on delete cascade,
  slot        smallint not null default 0,
  name        text,
  cards       text[] not null,
  troop       text not null,
  branch      text,
  updated_at  timestamptz not null default now(),
  primary key (account_id, slot)
);

-- ─────────────────────────────────────────────────────────── match_result
-- No cascade on delete. Removing an account must not silently rewrite the
-- opponent's history; deletion anonymises to a tombstone instead.
create table match_result (
  id            bigserial primary key,
  match_id      text not null unique,
  outcome       text not null,
  reason        text not null,
  duration_ms   integer not null,
  content_ver   text not null,
  finished_at   timestamptz not null default now()
);

-- One row per participant rather than seat1/seat2 columns.
--
-- 1v1 is the only mode today, and the schema does not need to say so. A 2v2
-- is the same table with four rows; seat1/seat2 columns would have been a
-- migration the first time a mode changed, for no saving in the meantime.
create table match_player (
  match_id    bigint not null references match_result(id) on delete cascade,
  account_id  text not null references account(id),
  team        smallint not null,
  seat        smallint not null,
  primary key (match_id, account_id)
);
create index match_player_history_idx on match_player (account_id, match_id desc);
