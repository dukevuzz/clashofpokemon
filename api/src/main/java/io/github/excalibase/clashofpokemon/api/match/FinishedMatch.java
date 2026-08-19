package io.github.excalibase.clashofpokemon.api.match;

import java.util.List;

/** What the game server reports when a match ends. */
public record FinishedMatch(
    String matchId,
    Outcome outcome,
    Reason reason,
    int durationMs,
    String contentVersion,
    List<MatchParticipant> players) {

  /** Did this participant's team win? Asked of the value, not of a string. */
  public boolean won(MatchParticipant player) {
    return outcome.wonBy(player.team());
  }

  public boolean drawn() {
    return outcome.drawn();
  }
}
