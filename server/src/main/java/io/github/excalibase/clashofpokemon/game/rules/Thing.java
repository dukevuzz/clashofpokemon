package io.github.excalibase.clashofpokemon.game.rules;

/** Anything that can be attacked. */
public sealed interface Thing permits Unit, Tower {

  int id();

  double x();

  double y();

  int hp();

  Side side();

  boolean dead();

  /** Physical armour, and the special kind. Towers have both too. */
  int def();

  int speDef();

  default boolean isTower() {
    return this instanceof Tower;
  }
}
