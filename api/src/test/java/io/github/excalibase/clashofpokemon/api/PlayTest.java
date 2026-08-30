package io.github.excalibase.clashofpokemon.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.auth.GuestService;
import io.github.excalibase.clashofpokemon.api.play.Mode;
import io.github.excalibase.clashofpokemon.api.play.Result;
import io.github.excalibase.clashofpokemon.api.play.PlayService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Counting the matches the server never runs.
 *
 * Offline and tutorial play happens entirely in the browser, so the only
 * players that could be measured were the ones who pressed PLAY ONLINE.
 * Somebody who plays five bot matches and never goes online looked exactly
 * like somebody who opened the page and left -- which made "hardly anyone
 * plays more than once" a statement about the measurement, not the players.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class PlayTest {

  @Autowired PlayService plays;
  @Autowired io.github.excalibase.clashofpokemon.api.auth.AccountRepository accounts;
  @Autowired GuestService guests;
  @Autowired JdbcClient db;

  private String someone() {
    return guests.create().account().id();
  }

  private int rows(String account) {
    return db.sql("select count(*) from play where account_id = ?")
        .param(account).query(Integer.class).single();
  }

  @Test
  void recordsAnOfflineMatch() {
    String me = someone();
    plays.record(me, Mode.OFFLINE, null);
    assertThat(rows(me)).isEqualTo(1);
  }

  @Test
  void countsEveryMatchRatherThanEveryPlayer() {
    // Five bot matches from one person is precisely the signal the
    // online-only numbers could not see.
    String me = someone();
    for (int i = 0; i < 5; i++) plays.record(me, Mode.OFFLINE, null);
    assertThat(rows(me)).isEqualTo(5);
  }

  @Test
  void keepsTheTutorialApartFromOrdinaryPlay() {
    // "Did anyone finish the tutorial" is a different question from "did
    // anyone play", and the mode column is what keeps both answerable.
    String me = someone();
    plays.record(me, Mode.TUTORIAL, null);
    plays.record(me, Mode.OFFLINE, null);

    String first = db.sql("select mode from play where account_id = ? order by id limit 1")
        .param(me).query(String.class).single();
    assertThat(first).isEqualTo("tutorial");
    assertThat(rows(me)).isEqualTo(2);
  }

  @Test
  void refusesAModeItDoesNotKnow() {
    // Online matches are counted by the server that ran them. Letting a client
    // claim one here would be a second set of books that disagrees with the
    // first, and no way to tell which was right.
    assertThatThrownBy(() -> Mode.of("online")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Mode.of(null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Mode.of("")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void readsTheWireSpellingForgivingly() {
    assertThat(Mode.of("Offline")).isEqualTo(Mode.OFFLINE);
    assertThat(Mode.of(" tutorial ")).isEqualTo(Mode.TUTORIAL);
  }

  @Test
  void anOfflineResultCountsTowardTheAccountsRecord() {
    // The record has to follow the account, not the browser. It did not:
    // `account.wins` was bumped only by online matches, so signing in on a
    // second device showed a player with hundreds of bot matches a blank
    // record -- and signing out on the first device wiped the only copy.
    var guest = guests.create();
    String id = guest.account().id();

    plays.record(id, Mode.OFFLINE, Result.WIN);
    plays.record(id, Mode.OFFLINE, Result.WIN);
    plays.record(id, Mode.OFFLINE, Result.LOSS);
    plays.record(id, Mode.OFFLINE, Result.DRAW);

    var after = accounts.find(id).orElseThrow();
    assertThat(after.wins()).isEqualTo(2);
    assertThat(after.losses()).isEqualTo(1);
    assertThat(after.draws()).isEqualTo(1);
  }

  @Test
  void aPlayWithNoResultStillCounts() {
    // The tutorial has no winner, and older clients send no result at all.
    // Neither may fail, and neither may move the record.
    var guest = guests.create();
    String id = guest.account().id();
    plays.record(id, Mode.TUTORIAL, null);

    assertThat(db.sql("select count(*) from play where account_id = ?")
        .param(id).query(Integer.class).single()).isEqualTo(1);
    var after = accounts.find(id).orElseThrow();
    assertThat(after.wins() + after.losses() + after.draws()).isZero();
  }
}
