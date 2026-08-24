package io.github.excalibase.clashofpokemon.api.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

/** The migration, run against the database it will actually run against. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class SchemaTest {

  @Autowired JdbcClient db;

  private String newAccount(String name) {
    return newAccount("acct_" + name, name);
  }

  private String newAccount(String id, String name) {
    db.sql("insert into account (id, display_name) values (?, ?)")
        .params(id, name).update();
    return id;
  }

  @Test
  void migrationCreatesEveryTable() {
    List<String> tables = db.sql("""
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name <> 'flyway_schema_history'
        order by table_name
        """).query(String.class).list();

    // containsExactly, not contains: a table that appears without anybody
    // meaning it to is exactly what this is here to notice.
    assertThat(tables).containsExactly(
        "account", "deck", "external_identity", "feedback",
        "match_player", "match_result", "play", "refresh_token");
  }

  @Test
  void aNameCanBelongToAsManyAccountsAsLikeIt() {
    // display_name was `unique`, which made it the identity as well as the
    // label. Two people could not both be called Duc, and guest sign-up had
    // to retry on a name collision -- a retry that could never work, because
    // the first DuplicateKeyException had already aborted the transaction.
    newAccount("acct_ember_1", "Ember101");
    newAccount("acct_ember_2", "Ember101");

    assertThat(db.sql("select count(*) from account where display_name = ?")
        .param("Ember101").query(Integer.class).single()).isEqualTo(2);
  }

  @Test
  void anAccountCanWearAFace() {
    String id = newAccount("Kindle700");
    assertThat(db.sql("select avatar from account where id = ?")
        .param(id).query(String.class).optional().orElse(null)).isNull();

    db.sql("update account set avatar = ? where id = ?").params("pikachu", id).update();
    assertThat(db.sql("select avatar from account where id = ?")
        .param(id).query(String.class).single()).isEqualTo("pikachu");
  }

  @Test
  void oneProviderIdentityCannotBindToTwoAccounts() {
    // This constraint *is* the "already linked" answer. Without it, two
    // simultaneous link requests both read "not linked" and both succeed,
    // and one person owns two accounts with no way to tell which is theirs.
    String a = newAccount("Ripple200");
    String b = newAccount("Pebble300");
    db.sql("insert into external_identity (provider, subject, account_id) values (?,?,?)")
        .params("google", "google-uid-1", a).update();

    assertThatThrownBy(() ->
        db.sql("insert into external_identity (provider, subject, account_id) values (?,?,?)")
            .params("google", "google-uid-1", b).update())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void aDeckBelongsToAnAccountAndASlot() {
    String id = newAccount("Gust400");
    db.sql("insert into deck (account_id, slot, cards, troop) values (?,?,?,?)")
        .params(id, 0, new String[] {"a", "b"}, "togekiss").update();
    // A second loadout is a second row, not a conflict.
    db.sql("insert into deck (account_id, slot, cards, troop) values (?,?,?,?)")
        .params(id, 1, new String[] {"c", "d"}, "crobat").update();

    assertThat(db.sql("select count(*) from deck where account_id = ?")
        .param(id).query(Integer.class).single()).isEqualTo(2);
  }

  @Test
  void deletingAnAccountTakesItsDeckButNotItsHistory() {
    // The record of a match belongs to both players. Cascading it away when
    // one leaves would silently rewrite the other's history.
    String winner = newAccount("Thorn500");
    String loser = newAccount("Cinder600");
    db.sql("insert into deck (account_id, cards, troop) values (?,?,?)")
        .params(loser, new String[] {"a"}, "togekiss").update();

    long match = db.sql("""
        insert into match_result (match_id, outcome, reason, duration_ms, content_ver)
        values (?,?,?,?,?) returning id
        """).params("m_1", "team1", "kingDown", 100_000, "v1")
        .query(Long.class).single();
    for (var seat : List.of(winner, loser)) {
      db.sql("insert into match_player (result_id, account_id, team, seat) values (?,?,?,?)")
          .params(match, seat, seat.equals(winner) ? 1 : 2, 1).update();
    }

    // The loser cannot be deleted while a match references them -- which is
    // the point. Deletion must anonymise, not erase.
    assertThatThrownBy(() ->
        db.sql("delete from account where id = ?").param(loser).update())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void aMatchIsRecordedOnlyOnce() {
    // The game server retries a failed report, and a retry after a timeout is
    // normal. Double-counting a win is not.
    db.sql("""
        insert into match_result (match_id, outcome, reason, duration_ms, content_ver)
        values (?,?,?,?,?)
        """).params("m_dup", "team1", "time", 180_000, "v1").update();

    assertThatThrownBy(() -> db.sql("""
        insert into match_result (match_id, outcome, reason, duration_ms, content_ver)
        values (?,?,?,?,?)
        """).params("m_dup", "team2", "time", 180_000, "v1").update())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void aMatchCanHoldMoreThanTwoPlayers() {
    // 1v1 today. The schema does not say so, and a 2v2 needs no migration --
    // which is why participants are rows rather than seat1/seat2 columns.
    long match = db.sql("""
        insert into match_result (match_id, outcome, reason, duration_ms, content_ver)
        values (?,?,?,?,?) returning id
        """).params("m_2v2", "team1", "kingDown", 120_000, "v1")
        .query(Long.class).single();

    int team = 1;
    for (String name : List.of("Quartz1", "Quartz2", "Drift1", "Drift2")) {
      String id = newAccount(name);
      db.sql("insert into match_player (result_id, account_id, team, seat) values (?,?,?,?)")
          .params(match, id, team <= 2 ? 1 : 2, team).update();
      team++;
    }
    assertThat(db.sql("select count(*) from match_player where result_id = ?")
        .param(match).query(Integer.class).single()).isEqualTo(4);
  }
}
