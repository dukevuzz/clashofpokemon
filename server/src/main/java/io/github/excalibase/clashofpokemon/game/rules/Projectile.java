package io.github.excalibase.clashofpokemon.game.rules;

/** A shot in the air. */
public final class Projectile {

  public double x;
  public double y;
  public Thing target;
  /** Last known target position, so a shot at a dying unit still lands there. */
  public double tx;
  public double ty;
  public int amount;
  public double mult;
  public Thing source;
  public double speed;
}
