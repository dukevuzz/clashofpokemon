package io.github.excalibase.clashofpokemon.api.match;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Who won, as a value rather than as a word. */
public enum Outcome {
  TEAM1("team1"),
  TEAM2("team2"),
  DRAW("draw");

  private final String wire;

  Outcome(String wire) {
    this.wire = wire;
  }

  /** The spelling the game server sends, which is also what is stored. */
  @JsonValue
  public String wire() {
    return wire;
  }

  /** Anything else is refused at the boundary. */
  @JsonCreator
  public static Outcome of(String value) {
    for (Outcome o : values()) {
      if (o.wire.equals(value)) return o;
    }
    throw new IllegalArgumentException("no such outcome: " + value);
  }

  public boolean wonBy(int team) {
    return this == TEAM1 && team == 1 || this == TEAM2 && team == 2;
  }

  public boolean drawn() {
    return this == DRAW;
  }
}
