package io.github.excalibase.clashofpokemon.api.match;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** The only file in this package that knows SQL. */
@Repository
public class MatchRepository {

  private final JdbcClient db;

  MatchRepository(JdbcClient db) {
    this.db = db;
  }

  /** Insert a match, unless it is already there. */
  Optional<Long> insertResult(FinishedMatch match) {
    return db.sql("""
        insert into match_result (match_id, outcome, reason, duration_ms, content_ver)
        values (?, ?, ?, ?, ?)
        on conflict (match_id) do nothing
        returning id
        """)
        .params(match.matchId(), match.outcome().wire(), match.reason().wire(),
            match.durationMs(), match.contentVersion())
        .query(Long.class).optional();
  }

  void insertPlayer(long resultId, MatchParticipant player) {
    db.sql("insert into match_player (result_id, account_id, team, seat) values (?,?,?,?)")
        .params(resultId, player.accountId(), player.team(), player.seat()).update();
  }

  /** Add one to a player's record. */
  void countWin(String accountId) {
    bump("update account set wins = wins + 1 where id = ?", accountId);
  }

  void countLoss(String accountId) {
    bump("update account set losses = losses + 1 where id = ?", accountId);
  }

  void countDraw(String accountId) {
    bump("update account set draws = draws + 1 where id = ?", accountId);
  }

  private void bump(String sql, String accountId) {
    db.sql(sql).param(accountId).update();
  }

  List<PlayedMatch> historyFor(String accountId, int limit) {
    return db.sql("""
        select r.match_id, r.outcome, r.reason, r.duration_ms, r.finished_at, p.team
        from match_player p join match_result r on r.id = p.result_id
        where p.account_id = ?
        order by r.finished_at desc
        limit ?
        """)
        .params(accountId, limit)
        .query((rs, n) -> {
          // Parsed back into the values rather than compared as strings, so a
          // row that somehow holds nonsense fails here instead of quietly
          // reading as a loss.
          Outcome outcome = Outcome.of(rs.getString("outcome"));
          return new PlayedMatch(
              rs.getString("match_id"),
              outcome.wonBy(rs.getInt("team")),
              outcome.drawn(),
              Reason.of(rs.getString("reason")),
              rs.getInt("duration_ms"),
              rs.getObject("finished_at", java.time.OffsetDateTime.class));
        })
        .list();
  }
}
