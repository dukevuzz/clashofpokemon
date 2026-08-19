package io.github.excalibase.clashofpokemon.game.rules;

import java.util.ArrayList;
import java.util.List;

/** A creature on the board. */
public final class Unit implements Thing {

  public int id;
  public Card card;
  public Side side;

  public double x;
  public double y;
  public int hp;
  public int maxHP;

  /** Copied from the card: read constantly, never changed by a fight. */
  public int damage;
  public int range;
  public int aggro;
  public double speed;
  public double attackRate;
  public int def;
  public int speDef;
  public double mass;
  public boolean flying;
  public boolean jumpsRiver;
  public List<String> targets;
  public int castEvery;

  /** Seconds until this can swing again. */
  public double cooldown;
  /** Attacks landed since the last cast. At `castEvery` it casts instead. */
  public int charge;

  public Thing target;
  public boolean dead;

  /** Temporary health that soaks damage before real health does. */
  public int shield;

  public int lane;
  /** PMD facing, 0 down through 7. Rendering reads it; rules do not. */
  public int facing;
  public String action = "Walk";
  public final List<Status> statuses = new ArrayList<>();

  /** Mid-leap over the river, or null on the ground. */
  public Leap leap;

  /** Seconds before this can act. */
  public double spawning;
  /** How long the arrival takes in total, so a renderer can draw the fraction. */
  public double arriveTime;

  /**
   * Where a tunneller surfaces, and where it set off from.
   *
   * Null for everything else. A digger travels from its own king to the spot
   * the player chose and cannot be touched on the way -- Clash Royale's Miner.
   */
  public double digToX;
  public double digToY;
  public double digFromX;
  public double digFromY;
  public boolean digs;

  public static final class Leap {
    public double t;
    public double duration;
    public double fromY;
    public double toY;
  }

  @Override public int id() { return id; }
  @Override public double x() { return x; }
  @Override public double y() { return y; }
  @Override public int hp() { return hp; }
  @Override public Side side() { return side; }
  @Override public boolean dead() { return dead; }
  @Override public int def() { return def; }
  @Override public int speDef() { return speDef; }

  /** Take damage that has already been mitigated. */
  public boolean take(int amount) {
    hp -= amount;
    if (hp > 0) return false;
    hp = 0;
    boolean justDied = !dead;
    dead = true;
    return justDied;
  }
}
