-- A display name is a label, not an identity.
--
-- `display_name` was `not null unique`, which made one column do two jobs. Two
-- players could not both be called Duc, and guest sign-up had to retry when a
-- generated name collided -- a retry that could never succeed, because the
-- first DuplicateKeyException aborts the transaction (SQLSTATE 25P02) and
-- every attempt after it fails the same way. With 14 name stems and 9900
-- numbers that collision arrives well before the table is large.
--
-- Dropping a unique constraint cannot fail and needs no backfill. The identity
-- it was standing in for is `username`, which arrives with login.
alter table account drop constraint account_display_name_key;

-- Searched only when somebody looks a player up, which is not a thing the game
-- does yet. No index until it is.

-- ─────────────────────────────────────────────────────────────────── avatar
-- The creature a player wears. Null means "not chosen": the client draws its
-- own default rather than the server picking one, so the fallback can change
-- without a migration.
--
-- Validated against the deckable roster in `ProfileService`, not here. A check
-- constraint would pin 151 card ids into the schema and need a migration every
-- time the roster grows.
alter table account add column avatar text;
