-- What the offline match was, not just that it happened.
--
-- `play` recorded the mode and nothing else, and `account.wins` was bumped
-- only by online results reported by the game server. So a player's record
-- lived in their browser: signing in on a second device showed a blank record
-- to somebody with hundreds of bot matches, and signing out on the first
-- wiped the only copy that existed.
--
-- Nullable, because a tutorial has no winner and an older client sends
-- nothing. Neither may fail, and neither counts.
alter table play add column result text
  check (result is null or result in ('win', 'loss', 'draw'));
