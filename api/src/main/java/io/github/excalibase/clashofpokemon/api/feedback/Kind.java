package io.github.excalibase.clashofpokemon.api.feedback;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** What a player is telling us. */
public enum Kind {
  /** Something is broken. */
  BUG("bug"),
  /** Something could be better. */
  SUGGESTION("suggestion");

  private final String wire;

  Kind(String wire) {
    this.wire = wire;
  }

  @JsonValue
  public String wire() {
    return wire;
  }

  @JsonCreator
  public static Kind of(String value) {
    for (Kind k : values()) {
      if (k.wire.equals(value)) return k;
    }
    throw new IllegalArgumentException("no such kind: " + value);
  }
}
