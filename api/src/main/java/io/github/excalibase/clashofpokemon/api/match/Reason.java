package io.github.excalibase.clashofpokemon.api.match;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** How a match ended. */
public enum Reason {
  /** A king fell. The way the game is meant to end. */
  KING_DOWN("kingDown"),
  /** The clock ran out and towers decided it. */
  TIME("time"),
  /** Somebody left. */
  FORFEIT("forfeit"),
  /** Nobody ever loaded, or both sides went away and stayed away. */
  ABANDONED("abandoned");

  private final String wire;

  Reason(String wire) {
    this.wire = wire;
  }

  @JsonValue
  public String wire() {
    return wire;
  }

  @JsonCreator
  public static Reason of(String value) {
    for (Reason r : values()) {
      if (r.wire.equals(value)) return r;
    }
    throw new IllegalArgumentException("no such reason: " + value);
  }
}
