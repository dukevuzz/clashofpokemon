-- The identity `display_name` was standing in for.
--
-- V5 freed the display name to be a label. This is the other half: the thing
-- you actually log in with. Null for every account that exists today, because
-- every account that exists today is a guest, so nothing needs backfilling.
alter table account add column username text;

-- Unique without regard to case.
--
-- A plain `unique` would let "Duc" and "duc" both exist, and one of them is
-- pretending to be the other. The index does the folding so that the check and
-- the lookup can never disagree about what counts as the same name -- which
-- they would if one were done in Java and the other in SQL.
--
-- Partial, because null is not a name: guests all have none, and a unique
-- index over them would be a large index of nothing.
create unique index account_username_key on account (lower(username))
  where username is not null;

-- Registration binds credentials to an account that already has a history, so
-- there is no state where a username exists without a password to go with it.
-- Said here as well as in the service, because the service can be bypassed by
-- anybody with a psql prompt and the schema cannot.
alter table account add constraint account_username_needs_password
  check (username is null or password_hash is not null);
