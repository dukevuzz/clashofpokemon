package io.github.excalibase.clashofpokemon.game.rules;

/** What can be afflicting a creature. */
public enum StatusKind {
  PARALYSIS("paralysis"),
  FLINCH("flinch"),
  CONFUSION("confusion"),
  ARMOR_BREAK("armorBreak"),
  BURN("burn"),
  POISON("poison"),
  SLEEP("sleep"),
  FREEZE("freeze"),
  SILENCE("silence"),
  CHARM("charm");

  private final String wire;

  StatusKind(String wire) {
    this.wire = wire;
  }

  /** The name the protocol and the fixtures use. */
  public String wire() {
    return wire;
  }

  public static StatusKind of(String wire) {
    for (StatusKind k : values()) {
      if (k.wire.equals(wire)) return k;
    }
    throw new IllegalArgumentException("no such status: " + wire);
  }
}
