-- What a player owns, moved off the device.
--
-- Until now the whole collection lived in localStorage: variants, shards,
-- coins and unopened chests. Two things were wrong with that, and only one of
-- them is about losing your progress when you clear a browser.
--
-- The other is that the pack was not real. `packs.open()` ran in the browser
-- against `Math.random()`, and the counts sat in a JSON blob the player could
-- edit. Anyone who opened devtools could grant themselves a thousand chests or
-- reroll until a legendary fell out. A collection nobody can cheat is the
-- point of having one, so the roll moves to the server with the rest.

-- One row per (creature, face, finish) held. `variant` is the same key the
-- client already builds: 'charmander', 'charmander#e7', 'charmander#e7#shiny'.
-- Storing the composed key rather than three columns keeps the client and the
-- server agreeing by construction -- there is one definition of what a variant
-- is, and it is a string both sides produce the same way.
create table collection (
  account_id text        not null references account (id) on delete cascade,
  variant    text        not null,
  got_at     timestamptz not null default now(),
  primary key (account_id, variant)
);

-- Shards are per creature, not a global pot: a shard is a claim on one
-- creature's faces and buys nothing else. The check is the invariant that
-- matters -- a spend must never be able to drive a balance negative, and
-- saying so here means it holds even if a future endpoint forgets to.
create table shard (
  account_id text    not null references account (id) on delete cascade,
  card_id    text    not null,
  amount     integer not null default 0 check (amount >= 0),
  primary key (account_id, card_id)
);

-- Coins and unopened chests belong to the account rather than a side table:
-- they are single values, they are read on every collection fetch, and a join
-- to read one integer is a join for nothing.
alter table account add column coins integer not null default 0 check (coins >= 0);
alter table account add column packs integer not null default 0 check (packs >= 0);

-- Counts up and rolls over rather than resetting, matching the client rule: a
-- player who earns a chest on match five starts match six one closer to the
-- next, not back at the beginning.
alter table account add column matches_since_pack integer not null default 0
  check (matches_since_pack >= 0);

-- The collection screen reads every variant a player holds, always filtered by
-- account. The primary key already leads with account_id, so that read is
-- covered; this index is for the other direction -- "who owns this variant" --
-- which is what any future trading, rarity or leaderboard question needs.
create index collection_variant_idx on collection (variant);
