package io.github.excalibase.clashofpokemon.api.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** The two words the game server and this tier have to agree on. */
class OutcomeTest {

  private static final ObjectMapper JSON = JsonMapper.builder().build();

  @Test
  void theWireSpellingIsWhatTheGameServerSends() {
    // These strings are a contract with another process. Changing one here
    // without changing it there is the failure this whole type exists to stop.
    assertThat(Outcome.TEAM1.wire()).isEqualTo("team1");
    assertThat(Outcome.TEAM2.wire()).isEqualTo("team2");
    assertThat(Outcome.DRAW.wire()).isEqualTo("draw");
    assertThat(Reason.KING_DOWN.wire()).isEqualTo("kingDown");
    assertThat(Reason.TIME.wire()).isEqualTo("time");
    assertThat(Reason.FORFEIT.wire()).isEqualTo("forfeit");
    assertThat(Reason.ABANDONED.wire()).isEqualTo("abandoned");
  }

  @Test
  void aReportIsReadBackAsValues() {
    String body = """
        {"matchId":"m_1","outcome":"team2","reason":"forfeit","durationMs":90000,
         "contentVersion":"c0ffee","players":[{"accountId":"ana","team":2,"seat":1}]}
        """;
    FinishedMatch match = JSON.readValue(body, FinishedMatch.class);

    assertThat(match.outcome()).isEqualTo(Outcome.TEAM2);
    assertThat(match.reason()).isEqualTo(Reason.FORFEIT);
  }

  @Test
  void anOutcomeNobodyDefinedIsRefusedAtTheEdge() {
    // A 400 to a game server that sent nonsense is a bug report. A stored row
    // is a mystery.
    for (String junk : new String[] {"TEAM1", "team_1", "team3", "", "won"}) {
      assertThatThrownBy(() -> Outcome.of(junk)).isInstanceOf(IllegalArgumentException.class);
    }
    for (String junk : new String[] {"KING_DOWN", "kingdown", "crash", ""}) {
      assertThatThrownBy(() -> Reason.of(junk)).isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void winningIsAskedOfTheValueRatherThanBuiltFromAString() {
    assertThat(Outcome.TEAM1.wonBy(1)).isTrue();
    assertThat(Outcome.TEAM1.wonBy(2)).isFalse();
    assertThat(Outcome.TEAM2.wonBy(2)).isTrue();
    // A draw is won by nobody, which the old string comparison also got right
    // -- and would have got wrong the moment a third team existed.
    assertThat(Outcome.DRAW.wonBy(1)).isFalse();
    assertThat(Outcome.DRAW.wonBy(2)).isFalse();
    assertThat(Outcome.DRAW.drawn()).isTrue();
    assertThat(Outcome.TEAM1.drawn()).isFalse();
  }

  @Test
  void everyValueSurvivesTheRoundTrip() {
    for (Outcome o : Outcome.values()) assertThat(Outcome.of(o.wire())).isEqualTo(o);
    for (Reason r : Reason.values()) assertThat(Reason.of(r.wire())).isEqualTo(r);
  }

  @Test
  void aValueGoesOutAsItsWireSpellingNotItsJavaName() {
    // Otherwise a client reading a history sees KING_DOWN where the protocol
    // says kingDown, and the two tiers describe the same match differently.
    assertThat(JSON.writeValueAsString(Outcome.TEAM1)).isEqualTo("\"team1\"");
    assertThat(JSON.writeValueAsString(Reason.KING_DOWN)).isEqualTo("\"kingDown\"");
  }
}
