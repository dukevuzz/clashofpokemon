package io.github.excalibase.clashofpokemon.game.rules;

/** A tower, and the creature riding it. */
public final class Tower implements Thing {

  public int id;
  public Side side;
  /** "side" or "king". */
  public String kind;

  public double x;
  public double y;
  public int hp;
  public int maxHP;

  public int damage;
  /**
   * How far this tower reaches, in world units.
   *
   * A double, not an int. It was an int, and the assignment truncated: a
   * king's 186.5 became 186, so every king in this engine fired half a unit
   * short of the one in TypeScript. Invisible except for a creature standing
   * in that half-unit band, which happened once in twenty-six recorded
   * matches -- and cost a blow, a shot, and days of looking for a
   * floating-point ghost that was never there.
   */
  public double range;
  public double cooldown;
  public boolean dead;

  /** Structures have no typing, so nothing is strong or weak against them. */
  public int def;
  public int speDef;

  /** A king does not fire until woken, and then not until it has woken up. */
  public boolean active;
  public double waking;

  /** Seconds between shots. A troop can make a lane tower faster or slower. */
  public double rate;

  /** A burst weapon's remaining shots, and how long it is dry for. */
  public Integer volleyShots;
  public Double volleyReload;
  public int ammo;
  public double reloading;

  @Override public int id() { return id; }
  @Override public double x() { return x; }
  @Override public double y() { return y; }
  @Override public int hp() { return hp; }
  @Override public Side side() { return side; }
  @Override public boolean dead() { return dead; }
  @Override public int def() { return def; }
  @Override public int speDef() { return speDef; }
}
