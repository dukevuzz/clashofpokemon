package io.github.excalibase.clashofpokemon.api.match;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import io.github.excalibase.clashofpokemon.api.auth.AccountRepository;
import io.github.excalibase.clashofpokemon.api.auth.GuestService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/** What happened, recorded once. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class MatchResultServiceTest {

  @Autowired MatchResultService matches;
  @Autowired GuestService guests;
  @Autowired AccountRepository accounts;

  private String someone() {
    return guests.create().account().id();
  }

  /** A match id nothing else in the suite can have. */
  private static String matchId(String label) {
    return "m_" + label + "_" + java.util.UUID.randomUUID().toString().substring(0, 8);
  }

  private FinishedMatch report(String id, String winner, String loser) {
    return new FinishedMatch(id, Outcome.TEAM1, Reason.KING_DOWN, 120_000, "v1",
        List.of(new MatchParticipant(winner, 1, 1), new MatchParticipant(loser, 2, 1)));
  }

  @Test
  void recordsAWinAndALoss() {
    String winner = someone();
    String loser = someone();
    matches.record(report(matchId("a"), winner, loser));

    assertThat(accounts.find(winner).orElseThrow().wins()).isEqualTo(1);
    assertThat(accounts.find(loser).orElseThrow().losses()).isEqualTo(1);
  }

  @Test
  void reportingTheSameMatchTwiceChangesNothing() {
    String winner = someone();
    String loser = someone();
    String id = matchId("b");
    matches.record(report(id, winner, loser));
    matches.record(report(id, winner, loser));

    assertThat(accounts.find(winner).orElseThrow().wins()).isEqualTo(1);
    assertThat(accounts.find(loser).orElseThrow().losses()).isEqualTo(1);
    assertThat(matches.historyFor(winner)).hasSize(1);
  }

  @Test
  void aDrawCountsForBoth() {
    String a = someone();
    String b = someone();
    matches.record(new FinishedMatch(matchId("c"), Outcome.DRAW, Reason.TIME, 180_000, "v1",
        List.of(new MatchParticipant(a, 1, 1), new MatchParticipant(b, 2, 1))));

    assertThat(accounts.find(a).orElseThrow().draws()).isEqualTo(1);
    assertThat(accounts.find(b).orElseThrow().draws()).isEqualTo(1);
  }

  @Test
  void bothPlayersSeeTheMatchInTheirHistory() {
    String winner = someone();
    String loser = someone();
    matches.record(report(matchId("d"), winner, loser));

    assertThat(matches.historyFor(winner)).hasSize(1);
    assertThat(matches.historyFor(loser)).hasSize(1);
    assertThat(matches.historyFor(winner).getFirst().won()).isTrue();
    assertThat(matches.historyFor(loser).getFirst().won()).isFalse();
  }

  @Test
  void aMatchWithFourPlayersRecordsAll() {
    // 1v1 is the only mode today and the schema does not say so. A 2v2 is the
    // same call with four participants.
    var players = List.of(
        new MatchParticipant(someone(), 1, 1), new MatchParticipant(someone(), 1, 2),
        new MatchParticipant(someone(), 2, 1), new MatchParticipant(someone(), 2, 2));
    matches.record(new FinishedMatch(matchId("2v2"), Outcome.TEAM1, Reason.KING_DOWN, 150_000, "v1", players));

    for (var p : players) {
      assertThat(matches.historyFor(p.accountId())).hasSize(1);
    }
    assertThat(accounts.find(players.get(0).accountId()).orElseThrow().wins()).isEqualTo(1);
    assertThat(accounts.find(players.get(2).accountId()).orElseThrow().losses()).isEqualTo(1);
  }
}
