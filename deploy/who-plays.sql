-- Who plays Clash of Pokémon.
--
-- "Accounts" is the wrong number and always flatters: an account is created
-- the moment somebody's browser touches the API, so it counts people who
-- opened the page and left. Every figure below is anchored on a match having
-- actually finished.

\echo '== people =='
select
  count(*)                                                         as accounts,
  count(*) filter (where wins + losses + draws > 0)                as played_at_least_once,
  count(*) filter (where wins + losses + draws >= 5)               as played_5_or_more,
  count(*) filter (where not guest)                                as registered,
  count(*) filter (where last_seen_at > now() - interval '1 day')  as seen_today,
  count(*) filter (where last_seen_at > now() - interval '7 days') as seen_this_week
from account;

\echo ''
\echo '== matches =='
select
  (select count(*) from play)                                   as offline_and_tutorial,
  (select count(*) from play where mode = 'offline')            as vs_bot,
  (select count(*) from play where mode = 'tutorial')           as tutorial,
  (select count(*) from match_result)                           as online;

\echo ''
\echo '== did they come back? =='
-- The number that matters most: playing on more than one separate day.
select
  count(*)                              as players_who_finished_a_match,
  count(*) filter (where days > 1)      as came_back_another_day,
  round(100.0 * count(*) filter (where days > 1) / nullif(count(*), 0), 1) as retention_pct
from (
  select account_id, count(distinct finished_at::date) as days
  from play group by account_id
) d;

\echo ''
\echo '== last 14 days =='
select finished_at::date as day,
       count(*)                       as matches,
       count(distinct account_id)     as players
from play
where finished_at > now() - interval '14 days'
group by 1 order by 1 desc;
