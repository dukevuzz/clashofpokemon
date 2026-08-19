-- Two facts the first migration left as free text, and one column name that
-- meant something different in each table it appeared in.
--
-- A separate migration rather than an edit to V1: V1 has been applied
-- somewhere, and Flyway compares checksums, so changing it turns every
-- existing database into a startup failure. Nothing here has run in
-- production yet, so folding these into V1 is defensible -- but only until
-- the day it isn't, and the cost of a second file is one file.

-- --------------------------------------------------------------- naming
--
-- `match_player.match_id` held `match_result.id`, a bigint, while
-- `match_result.match_id` held the text id the game server generates. One
-- name, two meanings, one table apart. The join was right, and the next
-- person to write one would naturally have written
-- `p.match_id = r.match_id` and got a type error -- or, with a less lucky
-- schema, silence.
alter table match_player rename column match_id to result_id;

-- ------------------------------------------------------------ the values
--
-- These cross a process boundary: the game server decides them and this tier
-- stores them, and until now nothing on either side checked that the two
-- agreed. The application refuses anything else at the edge now; this is so
-- that a migration, a fixture or a hand-run `psql` cannot write nonsense
-- either. Cheap to add, and the constraint is the documentation.
alter table match_result
  add constraint match_result_outcome_known
  check (outcome in ('team1', 'team2', 'draw'));

alter table match_result
  add constraint match_result_reason_known
  check (reason in ('kingDown', 'time', 'forfeit', 'abandoned'));
