package io.github.excalibase.clashofpokemon.game.rules;

/** How much of a hit actually lands. */
public final class Damage {

  private static final double ARMOUR_FACTOR = 0.05;

  private Damage() {}

  public static double mitigate(double amount, double defence) {
    return amount / (1 + ARMOUR_FACTOR * defence);
  }

  public static double mitigate(double amount) {
    return amount;
  }
}
