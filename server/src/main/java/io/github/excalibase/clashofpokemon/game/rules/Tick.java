package io.github.excalibase.clashofpokemon.game.rules;

import java.util.List;

/** One creature, one tower, one step. */
public final class Tick {

  private Tick() {}

  public static void updateUnit(Match match, Unit u, double dt) {
    if (u.spawning > 0 && u.digs) {
      /*
       * Underground, and on its way.
       *
       * Interpolated rather than walked: nothing down there collides, steers
       * or fights, so a straight line from the king to the hole is the whole
       * of the movement. The position really moves, because the renderer
       * draws the mound wherever the unit is -- the trail across the board is
       * not an effect, it is the unit.
       */
      double done = 1 - u.spawning / Math.max(0.0001, u.arriveTime);
      u.x = u.digFromX + (u.digToX - u.digFromX) * done;
      u.y = u.digFromY + (u.digToY - u.digFromY) * done;
    }
    if (u.spawning > 0) {
      u.spawning = countdown(u.spawning, dt);
      if (u.spawning > 0) return;
      // Surfaced. Land exactly where the player asked, rather than wherever
      // the last fraction of a frame happened to leave it.
      if (u.digs) { u.x = u.digToX; u.y = u.digToY; }
      match.events.add(new MatchEvent.Ready(u));

      // A drop lands on things. Applied at the *landing* rather than at the
      // deploy, because the opponent gets the whole delay to walk out of the
      // shadow -- which is what stops it being a free hit.
      if ("drop".equals(u.card.delivery())) {
        var c = Rules.config();
        for (Unit o : List.copyOf(match.units)) {
          if (o == u || o.dead || o.side == u.side) continue;
          if (Board.dist(u.x, u.y, o.x, o.y) > c.dropRadius()) continue;
          Combat.applyHit(match, o, u.damage * c.dropDamage(), Combat.matchup(u, o), u);
        }
      }
    }

    if (u.cooldown > 0) u.cooldown = countdown(u.cooldown, dt);
    if (!u.statuses.isEmpty()) Statuses.tick(u.statuses, dt);

    // Burn and poison: the only damage in the game with no attacker.
    // Proportional to maximum health, because a flat tick is a scratch on a
    // 600hp tank and lethal to a 150hp Caterpie.
    for (Status st : List.copyOf(u.statuses)) {
      if (st.kind != StatusKind.BURN && st.kind != StatusKind.POISON) continue;
      st.tick -= dt;
      if (st.tick > 0) continue;
      st.tick += Statuses.DOT_INTERVAL;

      int bite = Math.max(1, (int) Math.round(u.maxHP * Statuses.DOT_FRACTION));
      boolean killed = u.take(bite);
      // Straight to hp rather than through applyHit: there is no source, no
      // type matchup and no armour, and the hit path would fire retaliation
      // against an attacker that does not exist.
      match.events.add(new MatchEvent.Hit(u, bite, 1, u));
      if (killed) {
        match.events.add(new MatchEvent.Death(u));
        return;
      }
    }

    if (Statuses.frozen(u.statuses)) {
      u.action = "Idle";
      return;
    }

    if (u.leap != null) {
      u.leap.t += dt;
      double k = Math.min(1, u.leap.t / u.leap.duration);
      u.y = u.leap.fromY + (u.leap.toY - u.leap.fromY) * k;
      u.action = "Walk";
      if (k >= 1) u.leap = null;
      return;
    }

    // Let go of a target that died or ran too far. The slack means a creature
    // does not drop something the instant it steps out of range.
    if (u.target != null && (u.target.dead() || Board.gapTo(u, u.target) > u.aggro * 1.4)) {
      u.target = null;
    }
    /*
     * Keep what you are fighting; keep looking while you are only walking to
     * it.
     *
     * A target held from the moment it is chosen means a creature that locked
     * a tower from five tiles away walks *through* everything on the way --
     * seen in a screenshot: an enemy passing within nothing of a defender,
     * neither swinging. Clash Royale locks on when a troop is engaged, not
     * while it is travelling, and the difference is the whole feel of a lane.
     *
     * In range of the target, nothing pulls it off -- which is what stops a
     * Dugtrio mid-swing being yanked away by a poke. Out of range, it is still
     * shopping, and the nearest thing wins.
     */
    if (u.target != null && Board.gapTo(u, u.target) > u.range) {
      Thing nearer = Combat.findTarget(match, u, u.aggro);
      if (nearer != null && nearer != u.target) u.target = nearer;
    }
    if (u.target == null) u.target = Combat.findTarget(match, u, u.aggro);

    if (u.target != null) {
      double d = Board.gapTo(u, u.target);
      double tdx = u.target.x() - u.x;
      double tdy = u.target.y() - u.y;

      if (d <= u.range) {
        u.action = u.range > 30 ? "Shoot" : "Attack";
        u.facing = Board.facingFor(tdx, tdy);
        if (Statuses.has(u.statuses, StatusKind.FLINCH)) return;

        if (u.cooldown <= 0) {
          u.cooldown = u.attackRate;
          double mult = Combat.matchup(u, u.target);
          u.charge += 1;

          if (u.charge >= u.castEvery && Statuses.has(u.statuses, StatusKind.SILENCE)) {
            // Silenced: the charge is held rather than spent, so the cast
            // lands the moment the silence does.
            u.charge = u.castEvery;
          } else if (u.charge >= u.castEvery) {
            u.charge = 0;
            Combat.castSkill(match, u, u.target, mult);
            return;
          }

          if (u.range > 30) {
            // Ranged damage rides the projectile, so it lands when the shot
            // does rather than the instant the trigger is pulled -- and the
            // shot flies at a speed set by the shooter, since one stat drives
            // both. Square-rooted so the spread stays inside a playable band:
            // the raw ratio runs 0.7x to 1.5x, which doubles the gap between
            // the slowest and fastest shot.
            //
            // This was a flat speed here for a while, and it cost about one
            // hit per minute against the TypeScript -- not enough to look like
            // a bug, only like a match that went slightly differently.
            double shotSpeed = Rules.config().projectileSpeed()
                * Math.sqrt(u.speed / (Rules.config().unitSize() * 0.6));
            Combat.launch(match, u, u.target, u.damage, mult, shotSpeed);
          } else {
            Combat.applyHit(match, u.target, u.damage, mult, u);
          }
        }
        Movement.pushOutOfTowers(match.towers, u);
        return;
      }

      // In range of nothing yet: walk at it, round the river if need be.
      double wasY = u.y;
      double[] via = Movement.wayTo(u, u.target.x(), u.target.y());
      double vdx = via[0] - u.x;
      double vdy = via[1] - u.y;
      double len = Math.max(0.001, Board.span(vdx, vdy));
      u.action = "Walk";
      u.facing = Board.facingFor(vdx, vdy);
      double sp = Movement.speedOf(u);
      u.x += (vdx / len) * sp * dt;
      u.y += (vdy / len) * sp * dt;
      Movement.pushOutOfTowers(match.towers, u);
      Movement.keepOutOfRiver(u, wasY);
      return;
    }

    double[] goal = Movement.goalFor(match.towers, u);

    // Something that fights troops falls in behind a nearby win condition,
    // which is what makes an escort read as an escort rather than two
    // creatures that happen to be walking the same way.
    if (u.targets.contains("troop")) {
      Unit lead = null;
      double leadD = Double.MAX_VALUE;
      int forward = Board.forwardFor(u.side);
      for (Unit o : match.units) {
        if (o == u || o.dead || o.side != u.side || o.targets.contains("troop")) continue;
        boolean ahead = forward < 0 ? o.y < u.y : o.y > u.y;
        if (!ahead) continue;
        double d = Board.dist(u.x, u.y, o.x, o.y);
        if (d < 110 && d < leadD) { lead = o; leadD = d; }
      }
      if (lead != null) goal = new double[] {lead.x, lead.y - forward * 22};
    }

    double dx = goal[0] - u.x;
    double dy = goal[1] - u.y;
    double len = Math.max(0.001, Board.span(dx, dy));
    dx /= len;
    dy /= len;

    double wasY = u.y;
    double[] sep = Movement.separation(match.units, u);
    double squeeze = Movement.squeezePast(match.units, u, dx, dy);
    double sp = Movement.speedOf(u);

    // The squeeze is applied perpendicular to the way it is heading, so
    // getting past somebody does not slow the journey down.
    u.x += (dx + sep[0] + squeeze * -dy) * sp * dt;
    u.y += (dy + sep[1] + squeeze * dx) * sp * dt;

    Movement.pushOutOfTowers(match.towers, u);
    Movement.keepOutOfRiver(u, wasY);
    u.x = Math.max(8, Math.min(Rules.config().arenaWidth() - 8, u.x));
    u.action = "Walk";
    u.facing = Board.facingFor(dx, dy);
  }

  /**
   * Run a per-frame countdown, and land it exactly on zero.
   *
   * Every timer here is a repeated {@code -= dt}, and the frame it crosses
   * zero it lands on dust -- a few times ten-to-the-minus-seventeen either
   * side. Compare that with {@code > 0} and the answer depends on the last
   * bit, which is how a king finished waking one frame later here than in
   * TypeScript, fired a frame late, and left a blow missing from a match that
   * was otherwise identical to the bit. Clamping means both engines hold
   * exactly zero afterwards and every comparison downstream agrees.
   */
  public static double countdown(double value, double dt) {
    double left = value - dt;
    return left <= 1e-9 ? 0 : left;
  }

  public static void updateTower(Match match, Tower t, double dt) {
    if (!t.active) return;
    if (t.waking > 0) { t.waking = countdown(t.waking, dt); return; }

    // Reloading runs whether or not anything is in range, so a burst tower
    // that emptied itself into a dying swarm is dry when the next wave lands.
    // That gap is the archetype: it is what you bait, and what you punish.
    if (t.reloading > 0) {
      t.reloading = countdown(t.reloading, dt);
      if (t.reloading <= 0 && t.volleyShots != null) t.ammo = t.volleyShots;
      return;
    }
    if (t.cooldown > 0) { t.cooldown = countdown(t.cooldown, dt); return; }

    Unit best = null;
    double bestD = t.range;
    for (Unit u : match.units) {
      // Arriving is not being there -- the same rule every other targeting
      // path already follows. Without it a tunneller was shot under the ground
      // and a Snorlax in mid-air: a card the player has not finished placing
      // cannot be answered, only sniped.
      if (u.side == t.side || u.dead || Combat.arriving(u)) continue;
      double d = Board.dist(t.x, t.y, u.x, u.y);
      if (d < bestD) { best = u; bestD = d; }
    }
    if (best == null) return;

    t.cooldown = t.rate;
    Combat.launch(match, t, best, t.damage, 1, 260);
    if (t.volleyShots != null && --t.ammo <= 0) t.reloading = t.volleyReload;
  }

  /** Start a king's wake-up. Harmless to call on one already awake. */
  public static void wakeKing(Match match, Tower t) {
    if (t.active || t.dead) return;
    t.active = true;
    t.waking = Rules.config().kingWakeSeconds();
    match.events.add(new MatchEvent.KingWakes(t));
  }
}
