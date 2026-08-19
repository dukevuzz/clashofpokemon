package io.github.excalibase.clashofpokemon.game.rules;

/** Which end of the board. */
public enum Side {
  ONE(1),
  TWO(2);

  private final int wire;

  Side(int wire) {
    this.wire = wire;
  }

  /** The number that crosses the wire, matching the TypeScript's 1 and 2. */
  public int wire() {
    return wire;
  }

  public Side other() {
    return this == ONE ? TWO : ONE;
  }

  public static Side of(int wire) {
    return wire == 1 ? ONE : TWO;
  }
}
