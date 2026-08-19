package io.github.excalibase.clashofpokemon.game.rules;

/** Where things are, and how far apart. */
public final class Board {

  private Board() {}

  /**
   * Distances use sqrt, never Math.hypot.
   *
   * Math.hypot is permitted to be approximate and the JVM's approximation is
   * not V8's, so the two engines disagreed in the last bit of a distance.
   * Invisible almost everywhere; decisive at a boundary -- a projectile whose
   * remaining distance sat exactly on one frame's travel landed in one engine
   * and not the other, and the differential suite reported a single missing
   * blow, in a different match each time the rules moved.
   *
   * IEEE 754 requires sqrt to be correctly rounded, so this is bit-for-bit
   * identical in both. Overflow was the only thing hypot bought, and the board
   * is 384 by 672 units across.
   */
  public static double span(double dx, double dy) {
    return Math.sqrt(dx * dx + dy * dy);
  }

  public static double dist(double ax, double ay, double bx, double by) {
    return span(bx - ax, by - ay);
  }

  /** Half a tower's footprint: how far its wall stands from its centre. */
  public static double radiusOf(Thing thing) {
    return thing instanceof Tower t ? Rules.towerSize(t.kind) * 0.5 : 0;
  }

  /** Distance from a point to the edge of a thing. */
  public static double gapTo(double fromX, double fromY, Thing target) {
    if (!(target instanceof Tower tower)) {
      return Math.max(0, dist(fromX, fromY, target.x(), target.y()) - radiusOf(target));
    }
    double half = Rules.towerSize(tower.kind) * 0.5;
    double up = Rules.towerBox(tower.kind, "up");
    double down = Rules.towerBox(tower.kind, "down");

    double dx = Math.max(0, Math.abs(fromX - tower.x) - half);
    double dy = fromY < tower.y
        ? Math.max(0, tower.y - fromY - up)
        : Math.max(0, fromY - tower.y - down);
    return span(dx, dy);
  }

  public static double gapTo(Unit from, Thing target) {
    return gapTo(from.x, from.y, target);
  }

  /** Which way this side advances: side ONE walks up the board. */
  public static int forwardFor(Side side) {
    return side == Side.ONE ? -1 : 1;
  }

  /** Which bank of the river a y sits on: -1 above, 1 below, 0 in the water. */
  public static int bankOf(double y) {
    var c = Rules.config();
    double top = c.riverY() - c.riverHeight() / 2;
    double bot = c.riverY() + c.riverHeight() / 2;
    return y <= top ? -1 : y >= bot ? 1 : 0;
  }

  public static boolean onBridge(double x) {
    var c = Rules.config();
    for (double bx : c.bridgeX()) {
      if (Math.abs(x - bx) <= c.bridgeHalfWidth()) return true;
    }
    return false;
  }

  /** PMD facing from a direction: 0 is down, 4 is up, eight around. */
  public static int facingFor(double dx, double dy) {
    double angle = Math.atan2(dy, dx);
    return (int) ((Math.round((Math.PI / 2 - angle) / (Math.PI / 4)) % 8 + 8) % 8);
  }
}
