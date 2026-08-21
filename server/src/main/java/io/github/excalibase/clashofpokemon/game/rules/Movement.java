package io.github.excalibase.clashofpokemon.game.rules;

import java.util.List;

/** Getting somewhere, and not walking through things on the way. */
public final class Movement {

  private Movement() {}

  /** Paralysis leaves a creature at a fraction of its speed. */
  public static double speedOf(Unit u) {
    return Statuses.has(u.statuses, StatusKind.PARALYSIS)
        ? u.speed * Statuses.PARALYSIS_SPEED
        : u.speed;
  }

  /** Put back on land anything that ended a frame in the water. */
  public static void keepOutOfRiver(Unit u, double wasY) {
    var c = Rules.config();
    if (c.riverBypass() && u.flying) return;

    double top = c.riverY() - c.riverHeight() / 2;
    double bot = c.riverY() + c.riverHeight() / 2;

    if (c.riverBypass() && u.jumpsRiver) {
      if (u.leap != null) return;
      int from = Board.bankOf(wasY);
      if (from == 0 || Board.bankOf(u.y) == from) return;
      u.y = from < 0 ? top : bot;
      Unit.Leap leap = new Unit.Leap();
      leap.t = 0;
      leap.duration = c.leapTime();
      leap.fromY = u.y;
      leap.toY = from < 0 ? bot : top;
      u.leap = leap;
      return;
    }

    if (Board.bankOf(u.y) != 0) return;
    if (Board.onBridge(u.x)) return;

    int from = Board.bankOf(wasY);
    if (from == 0) {
      // Started in the water too: put it on whichever bank is nearer.
      u.y = (u.y - top < bot - u.y) ? top : bot;
      return;
    }
    u.y = from < 0 ? top : bot;
  }

  /** The next point to walk towards, which is not always the destination. */
  public static double[] wayTo(Unit u, double tx, double ty) {
    var c = Rules.config();
    if (c.riverBypass() && (u.flying || u.jumpsRiver)) return new double[] {tx, ty};

    int here = Board.bankOf(u.y);
    int there = Board.bankOf(ty);
    if (here == there || there == 0) return new double[] {tx, ty};

    double bx = c.bridgeX().get(u.lane);
    double top = c.riverY() - c.riverHeight() / 2;
    double bot = c.riverY() + c.riverHeight() / 2;

    if (here == 0) return new double[] {bx, there < 0 ? top : bot};

    boolean onIt = Math.abs(u.x - bx) <= c.bridgeHalfWidth() * 0.6;
    if (onIt) return new double[] {bx, here < 0 ? bot : top};

    return new double[] {bx, here < 0 ? top - c.bridgeApproach() : bot + c.bridgeApproach()};
  }

  /** What this creature is heading for. */
  public static double[] goalFor(List<Tower> towers, Unit u) {
    var c = Rules.config();
    int forward = Board.forwardFor(u.side);
    boolean crossed = Board.bankOf(u.y) == (forward < 0 ? -1 : 1);
    boolean bypasses = c.riverBypass() && (u.flying || u.jumpsRiver);

    if (!bypasses && !crossed) {
      double bx = c.bridgeX().get(u.lane);
      double bank = c.riverHeight() / 2 + 2;
      boolean lined = Math.abs(u.x - bx) <= c.bridgeHalfWidth() * 0.6;
      if (!lined) {
        return new double[] {bx, c.riverY() - forward * (bank + c.bridgeApproach())};
      }
      return new double[] {bx, c.riverY() + forward * bank};
    }

    Tower best = null;
    for (Tower t : towers) {
      if (t.side == u.side || t.dead) continue;
      if ("side".equals(t.kind) && (t.x < c.arenaWidth() / 2.0 ? 0 : 1) == u.lane) {
        best = t;
        break;
      }
    }
    if (best == null) {
      for (Tower t : towers) {
        if (t.side != u.side && !t.dead && "king".equals(t.kind)) { best = t; break; }
      }
    }
    if (best == null) {
      double bestD = Double.MAX_VALUE;
      for (Tower t : towers) {
        if (t.side == u.side || t.dead) continue;
        double d = Board.gapTo(u, t);
        if (d < bestD) { best = t; bestD = d; }
      }
    }
    if (best == null) return new double[] {u.x, u.y + forward * 100};

    double dx = best.x - u.x;
    double dy = best.y - u.y;
    double len = Math.max(0.001, Board.span(dx, dy));
    double stand = Board.radiusOf(best) + 6;
    return new double[] {best.x - (dx / len) * stand, best.y - (dy / len) * stand};
  }

  /** How hard the crowd is pushing this creature aside. */
  public static double[] separation(List<Unit> units, Unit u) {
    double crowd = Rules.config().crowdRadius();
    double sx = 0;
    double sy = 0;

    for (int i = 0; i < units.size(); i++) {
      Unit o = units.get(i);
      if (o == u || o.dead || o.flying != u.flying) continue;
      // Underground is not on the board. A digger passing beneath a crowd
      // must not shove it aside -- unlike a landing Snorlax, which is a rock
      // and is meant to be one.
      if (o.digs && o.spawning > 0) continue;
      double dx = u.x - o.x;
      double dy = u.y - o.y;
      double d2 = dx * dx + dy * dy;
      if (d2 >= crowd * crowd) continue;

      double share = o.spawning > 0 ? 1 : o.mass / (u.mass + o.mass);
      if (d2 < 0.01) {
        // Exactly on top of each other: push apart in a direction that varies
        // by index, or a stack of identical units never separates. Read from a
        // table rather than computed, so both engines agree bit for bit.
        double[] bearing = Rules.spreadFor(i);
        sx += bearing[0] * 0.8;
        sy += bearing[1] * 0.8;
      } else {
        double d = Math.sqrt(d2);
        double push = ((crowd - d) / crowd) * 1.6 * share;
        sx += (dx / d) * push;
        sy += (dy / d) * push;
      }
    }
    return new double[] {sx, sy};
  }

  /** A sideways nudge so a faster creature can get past a slower friend. */
  public static double squeezePast(List<Unit> units, Unit u, double dirX, double dirY) {
    double nudge = 0;
    for (Unit o : units) {
      if (o == u || o.dead || o.flying != u.flying) continue;
      if (o.side != u.side) continue;
      if (o.speed >= u.speed) continue;

      double dx = o.x - u.x;
      double dy = o.y - u.y;
      double d = Board.span(dx, dy);
      if (d > 26 || d < 0.01) continue;
      if ((dx * dirX + dy * dirY) / d < 0.7) continue;

      double speedEdge = Math.min(1, (u.speed - o.speed) / Math.max(1, o.speed));
      double massEdge = u.mass / (u.mass + o.mass);
      double side = dx >= 0 ? -1 : 1;
      nudge += side * speedEdge * massEdge * 1.4;
    }
    return nudge;
  }

  /** Shove anything standing inside stonework back out. */
  public static void pushOutOfTowers(List<Tower> towers, Unit u) {
    if (u.flying) return;
    var c = Rules.config();

    for (Tower t : towers) {
      if (t.dead) continue;
      double r = Board.radiusOf(t) + 4;
      double up = Board.boxUp(t);
      double down = Board.boxDown(t);
      double dx = u.x - t.x;
      double dy = u.y - t.y;
      if (Math.abs(dx) >= r) continue;
      if (dy < -up || dy > down) continue;

      double side = dx >= 0 ? 1 : -1;
      double target = t.x + side * r;
      // Pushed the other way if that would put it off the board.
      u.x = (target < 8 || target > c.arenaWidth() - 8) ? t.x - side * r : target;
      u.x = Math.max(8, Math.min(c.arenaWidth() - 8, u.x));
    }
  }
}
