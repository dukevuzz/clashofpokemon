-- Somewhere for players to say what is wrong.
--
-- The alternative was a link to an issue tracker, and that loses almost
-- everybody: a player who has just watched something go wrong mid-match will
-- write two sentences into a box that is already open, and will not create an
-- account somewhere else to do it. So the box lives in the game.

create table feedback (
  id          bigserial primary key,
  -- Tied to an account rather than anonymous. Everyone playing already has one
  -- (a guest is an account), so this costs the player nothing and it is what
  -- makes rate limiting and follow-up possible at all.
  account_id  text not null references account(id) on delete cascade,
  kind        text not null,
  message     text not null,
  -- What the client knew at the time: its build, the screen the player was on,
  -- the match if there was one. Free-form because the useful fields are not
  -- knowable in advance, and a report is worth more with too much context than
  -- with a schema that forbade the field that would have explained it.
  context     jsonb,
  created_at  timestamptz not null default now(),
  -- Triage, written by us and never by the client.
  handled_at  timestamptz,

  constraint feedback_kind check (kind in ('bug', 'suggestion')),
  -- Bounded in the database as well as the service. The service is where a
  -- friendly message comes from; this is what holds if a future caller forgets
  -- to ask it.
  constraint feedback_message_length check (char_length(message) between 4 and 2000)
);

-- Reading is always "newest first", either everything or one account's.
create index feedback_recent_idx on feedback (created_at desc);
create index feedback_account_idx on feedback (account_id, created_at desc);
