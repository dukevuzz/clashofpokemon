-- Matches played where nobody is watching.
--
-- Offline and tutorial matches never touch the game server: they are simulated
-- in the browser and stored in localStorage. So the only players we could count
-- were the ones who pressed PLAY ONLINE, and a player who plays five bot
-- matches and never goes online looked exactly like somebody who bounced off
-- the front page. "Only 3 people played more than one match" was measured
-- against a number that could not see most of the playing.
--
-- One row per finished match. Mode and when, and nothing else -- no board, no
-- deck, no result. It answers "did anyone play this", which is the question,
-- and cannot answer anything about a particular person, which is not.
create table play (
  id           bigint generated always as identity primary key,
  account_id   text        not null references account (id) on delete cascade,
  mode         text        not null check (mode in ('offline', 'tutorial')),
  finished_at  timestamptz not null default now()
);

-- The two questions actually asked: how many a day, and who came back.
create index play_finished_at_idx on play (finished_at desc);
create index play_account_idx on play (account_id, finished_at desc);
