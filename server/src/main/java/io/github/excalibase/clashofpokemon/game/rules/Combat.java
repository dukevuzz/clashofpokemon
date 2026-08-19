package io.github.excalibase.clashofpokemon.game.rules;

import java.util.ArrayList;
import java.util.List;

/** Choosing what to hit, and what happens when you do. */
public final class Combat {

  private Combat() {}

  /** Type advantage between two things. Towers have no typing. */
  /**
   * Is this unit still on its way in?
   *
   * A tolerance, not {@code > 0}. {@code spawning} counts down by a fixed dt,
   * so on the frame it runs out it lands on float dust -- measured at -3.5e-16
   * -- and whether that dust is above or below zero depends on the last bit of
   * the arrival time, which the JVM and V8 do not compute identically. Ask
   * {@code > 0} and the two engines disagree about whether a tower may fire on
   * that one frame, which is exactly how a single missing blow turned up in
   * the differential suite.
   *
   * A nanosecond is a hundred-millionth of a frame: far too small to change
   * what anybody sees, far too large for rounding to reach.
   */
  public static final double ARRIVING = 1e-9;

  public static boolean arriving(Unit u) {
    return u.spawning > ARRIVING;
  }

  public static double matchup(Thing attacker, Thing target) {
    String a = attacker instanceof Unit u ? u.card.sheet() : null;
    String d = target instanceof Unit u ? u.card.sheet() : null;
    if (a == null || d == null) return 1;
    return TypeChart.multiplier(a, d);
  }

  /** What this creature should attack, within a radius. */
  public static Thing findTarget(Match match, Unit u, double radius) {
    for (Status s : u.statuses) {
      if (s.kind == StatusKind.CHARM && s.by != null) {
        for (Unit o : match.units) {
          if (o.id == s.by && !o.dead) return o;
        }
      }
    }

    if (Statuses.has(u.statuses, StatusKind.CONFUSION)) {
      List<Thing> near = new ArrayList<>();
      if (u.targets.contains("troop")) {
        for (Unit o : match.units) {
          if (o.side == u.side || o.dead || arriving(o)) continue;
          if (Board.dist(u.x, u.y, o.x, o.y) < radius) near.add(o);
        }
      }
      for (Tower t : match.towers) {
        if (t.side == u.side || t.dead) continue;
        if (Board.gapTo(u, t) < radius) near.add(t);
      }
      if (near.isEmpty()) return null;
      return near.get((int) Math.floor(match.rng.nextDouble() * near.size()));
    }

    Thing best = null;
    double bestD = radius;

    if (u.targets.contains("troop")) {
      int forward = Board.forwardFor(u.side);
      // A full circle filters nothing, and saying so outright beats relying on
      // cos(180) being exactly -1 in two languages. `dy / d` for something
      // directly behind lands on -1 in one engine and a hair below it in the
      // other -- V8's Math.hypot and the JVM's are both approximate and not
      // the same approximation -- so the two disagreed about whether a unit
      // right behind another could be seen. Unreachable while the arc was a
      // cone; the normal case once it is a circle.
      boolean wholeCircle = Rules.config().aggroArc() >= 180;
      double minCos = Math.cos(Math.toRadians(Rules.config().aggroArc()));
      for (Unit o : match.units) {
        if (o.side == u.side || o.dead || arriving(o)) continue;
        double dx = o.x - u.x;
        double dy = o.y - u.y;
        double d = Board.span(dx, dy);
        if (d >= bestD) continue;
        // Outside the forward arc: not seen, however close.
        if (!wholeCircle && d > 0.001 && (dy * forward) / d < minCos) continue;
        best = o;
        bestD = d;
      }
    }

    /*
     * Towers are measured centre to centre here, like creatures.
     *
     * gapTo measures to the edge of a tower's box, which is right for deciding
     * whether you can *hit* it and wrong for deciding what to go for: a tower
     * a tile away read as nearer than a defender two tiles away, so attackers
     * walked past the creature sent to stop them.
     *
     * Two special cases were tried before this and both were worse. One rule,
     * measured the same way for everything: the nearest thing wins.
     */
    for (Tower t : match.towers) {
      if (t.side == u.side || t.dead) continue;
      double d = Board.span(t.x - u.x, t.y - u.y);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  /** Damage something, and deal with everything that follows from it. */
  public static int applyHit(
      Match match, Thing target, double amount, double mult, Thing source) {
    return applyHit(match, target, amount, mult, source, "physical");
  }

  public static int applyHit(
      Match match, Thing target, double amount, double mult, Thing source, String resist) {

    double armour = switch (resist) {
      case "special" -> target.speDef();
      case "none" -> 0;
      default -> target.def();
    };
    // Broken armour weakens whichever defence this attack was going to be
    // reduced by, rather than a single generic number -- which would make
    // physical and special attacks interchangeable.
    if (target instanceof Unit tu && Statuses.has(tu.statuses, StatusKind.ARMOR_BREAK)) {
      armour *= 1 - Statuses.ARMOR_BREAK;
    }

    int dealt = (int) Math.round(Damage.mitigate(amount * mult, armour));
    if (target instanceof Unit tu && dealt > 0) Statuses.wake(tu.statuses);

    int through = dealt;
    if (target instanceof Unit tu && tu.shield > 0) {
      // A shield soaks first, after mitigation: it is extra health, not
      // immunity, and stacking it in front of armour would make one card's
      // buff worth more on a tank than the tank's own armour.
      int soaked = Math.min(tu.shield, through);
      tu.shield -= soaked;
      through -= soaked;
    }

    boolean killed = target instanceof Unit tu ? tu.take(through) : false;
    if (target instanceof Tower tt) tt.hp -= through;

    match.events.add(new MatchEvent.Hit(target, dealt, mult, source));

    /*
     * Hit me while I have nothing to hit, and I will look at you.
     *
     * Only then. This used to pull a creature off a *tower* as well, so a
     * Dugtrio mid-swing at a crown tower would turn round and chase whatever
     * poked it -- against the rule that a target is kept until it dies or
     * leaves reach. It existed because awareness was a 220-degree cone; the
     * arc is a full circle now, so nothing has to be yanked.
     */
    if (target instanceof Unit tu && tu.targets.contains("troop")
        && !(source instanceof Tower)) {
      if (tu.target == null) tu.target = source;
    }

    // A king being hit stops sleeping through it.
    if (target instanceof Tower tt && "king".equals(tt.kind)) Tick.wakeKing(match, tt);

    if (killed || (target instanceof Tower && target.hp() <= 0)) {
      if (target instanceof Tower tt) { tt.hp = 0; tt.dead = true; }
      match.events.add(new MatchEvent.Death(target));

      if (target instanceof Tower tt) {
        match.events.add(new MatchEvent.TowerDown(tt));
        if ("side".equals(tt.kind)) {
          // Losing a lane tower wakes the king behind it.
          for (Tower t : match.towers) {
            if (t.side == tt.side && "king".equals(t.kind)) Tick.wakeKing(match, t);
          }
        }
      }
    }
    return dealt;
  }

  /** Inflict a move's status, if it has one and it lands. */
  public static void afflict(Match match, Thing target, String skill, Unit by) {
    if (skill == null || !(target instanceof Unit u) || u.dead) return;
    Statuses.Effect effect = Statuses.MOVE_STATUS.get(skill);
    if (effect == null) return;
    if (effect.chance() < 1 && match.rng.nextDouble() >= effect.chance()) return;

    Statuses.apply(u.statuses, effect.kind(), effect.seconds(), by == null ? null : by.id);
    match.events.add(new MatchEvent.Afflicted(u, effect.kind(), effect.seconds()));
  }

  /** The special: bigger damage on the target, splash on everything near it. */
  public static void castSkill(Match match, Unit u, Thing target, double mult) {
    match.events.add(new MatchEvent.Cast(u, target, u.card.skill()));

    Skills.Effect effect = Skills.effectFor(u.card.skill());
    if (effect != null) {
      boolean wantsAllies = effect.kind().equals("heal") || effect.kind().equals("shield");
      List<Unit> allies = new ArrayList<>();
      if (wantsAllies) {
        for (Unit o : match.units) {
          if (o.side == u.side && !o.dead
              && Board.dist(u.x, u.y, o.x, o.y) <= Skills.RADIUS) {
            allies.add(o);
          }
        }
      }
      Skills.applyEffect(match, match.towers, u,
          allies.isEmpty() ? List.of(u) : allies, effect);
      return;
    }

    Double powered = Skills.poweredDamage(
        u.card.skill(), u, target instanceof Unit tu ? tu : null);
    double amount = powered != null ? powered : u.card.skillAmount();
    String resist = u.card.skillResist();

    applyHit(match, target, amount, mult, u, resist);
    afflict(match, target, u.card.skill(), u);

    for (Unit o : List.copyOf(match.units)) {
      if (o.side == u.side || o.dead || o == target || arriving(o)) continue;
      if (Board.dist(target.x(), target.y(), o.x, o.y) <= Skills.RADIUS) {
        applyHit(match, o, amount * 0.5, matchup(u, o), u, resist);
        afflict(match, o, u.card.skill(), u);
      }
    }
  }

  public static void launch(
      Match match, Thing source, Thing target, int amount, double mult, double speed) {
    Projectile p = new Projectile();
    p.x = source.x();
    p.y = source.y() - 8;
    p.target = target;
    p.tx = target.x();
    p.ty = target.y() - 6;
    p.amount = amount;
    p.mult = mult;
    p.source = source;
    p.speed = speed;
    match.projectiles.add(p);
    match.events.add(new MatchEvent.Shot(source, target, amount, mult));
  }

  /** Advance every shot, and apply it where it lands. */
  public static void updateProjectiles(Match match, double dt) {
    for (int i = match.projectiles.size() - 1; i >= 0; i--) {
      Projectile p = match.projectiles.get(i);
      if (!p.target.dead()) {
        p.tx = p.target.x();
        p.ty = p.target.y() - 6;
      }
      double dx = p.tx - p.x;
      double dy = p.ty - p.y;
      double d = Board.span(dx, dy);
      double step = p.speed * dt;

      if (d <= step) {
        match.projectiles.remove(i);
        if (!p.target.dead()) applyHit(match, p.target, p.amount, p.mult, p.source);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
  }
}
