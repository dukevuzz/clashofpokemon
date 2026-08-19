package io.github.excalibase.clashofpokemon.api.play;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Counting the matches nobody else can see.
 *
 * Deliberately the smallest thing that answers the question. A finished offline
 * or tutorial match becomes one row saying which of the two it was and when.
 * There is no result, no deck and no board state, because none of that is
 * needed to know whether people are playing -- and storing it would turn a
 * counter into a record of how somebody spends their evening.
 */
@Service
public class PlayService {

  private final JdbcClient db;

  PlayService(JdbcClient db) {
    this.db = db;
  }

  public void record(String accountId, Mode mode) {
    db.sql("insert into play (account_id, mode) values (?, ?)")
        .params(accountId, mode.wire())
        .update();
  }
}
