/** One creature's frame, and one tower's. */

import { config, forwardFor } from "./config";
import * as status from "./status";
import * as movement from "./movement";
import * as combat from "./combat";
import { gapTo, facingFor, type Match, type Unit, type Tower } from "./match";

/*
 * Distances use sqrt, never Math.hypot.
 *
 * Math.hypot is permitted to be approximate and V8's approximation is not the
 * JVM's, so the two engines disagreed in the last bit of a distance. Invisible
 * almost everywhere; decisive at a boundary -- a projectile whose remaining
 * distance sat exactly on one frame's travel landed in one engine and not the
 * other, and the differential suite reported a single missing blow, in a
 * different match each time the rules moved.
 *
 * IEEE 754 requires sqrt to be correctly rounded, so this is bit-for-bit
 * identical in both. Overflow was the only thing hypot bought, and the board
 * is 384 by 672 units across.
 */
const span = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);


const dist = (ax: number, ay: number, bx: number, by: number) =>
  span(bx - ax, by - ay);


export function updateUnit(
  match: Match,
  u: Unit, dt: number) {
  // Still landing: visible, targetable, and inert.
  if (u.spawning > 0 && u.digFrom && u.digTo) {
    /*
     * Underground, and on its way.
     *
     * The position is interpolated rather than walked: nothing down there
     * collides, steers or fights, so a straight line from your king to the
     * hole is the whole of the movement. It matters that `x` and `y` really
     * move -- the renderer draws the mound wherever the unit is, so the trail
     * across the board is not an effect, it is the unit.
     */
    const done = 1 - u.spawning / Math.max(0.0001, u.arriveTime);
    u.x = u.digFrom.x + (u.digTo.x - u.digFrom.x) * done;
    u.y = u.digFrom.y + (u.digTo.y - u.digFrom.y) * done;
  }
  if (u.spawning > 0) {
    u.spawning = countdown(u.spawning, dt);
    match.note("unit.arriving", "continuous", u.side, { id: u.id, left: u.spawning });
    if (u.spawning > 0) return;
    // Surfaced. Land exactly where the player asked, rather than wherever the
    // last fraction of a frame happened to leave it.
    if (u.digTo) { u.x = u.digTo.x; u.y = u.digTo.y; }
    match.note("unit.ready", "discrete", u.side, { id: u.id });
    match.events.push({ type: "ready", unit: u });

    // A drop lands on things. Applied here rather than at deploy because the
    // point is the *landing* -- the opponent gets the whole deploy delay to
    // walk out of the shadow, which is what stops it being a free hit.
    if (u.card.delivery === "drop") {
      const { radius, damage } = config.dropImpact;
      for (const o of match.units) {
        if (o === u || o.dead || o.side === u.side) continue;
        if (dist(u.x, u.y, o.x, o.y) > radius) continue;
        combat.applyHit(match, o, u.damage * damage, combat.matchup(u, o), u);
      }
    }
  }
  if (u.cooldown > 0) {
    u.cooldown = countdown(u.cooldown, dt);
    match.note("unit.cooldown", "local", u.side, { id: u.id });
  }
  if (u.statuses.length) {
    status.tick(u.statuses, dt);
    match.note("status.tick", "continuous", u.side, {
      id: u.id, kinds: u.statuses.map((s) => s.kind).join(","),
    });
  }

  // Burn and poison: the first damage in match game that comes from no
  // attacker. Proportional to max health, because a flat tick is a scratch on
  // a 600hp tank and lethal to a 150hp Caterpie.
  for (const st of u.statuses) {
    if (st.kind !== "burn" && st.kind !== "poison") continue;
    st.tick = (st.tick ?? status.DOT_INTERVAL) - dt;
    if (st.tick > 0) continue;
    st.tick += status.DOT_INTERVAL;
    // Straight to hp, not through applyHit: there is no source, no type
    // matchup and no armour involved, and routing it through the hit path
    // would fire retaliation against an attacker that does not exist.
    const bite = Math.max(1, Math.round(u.maxHP * status.DOT_FRACTION));
    u.hp -= bite;
    match.note("unit.dot", "discrete", u.side, { id: u.id, bite, kind: st.kind });
    match.events.push({
      type: "hit", target: u, amount: bite, mult: 1, source: u,
    });
    if (u.hp <= 0) {
      u.hp = 0; u.dead = true;
      match.events.push({ type: "death", thing: u });
      return;
    }
  }

  // Asleep or frozen: on the board, targetable, and doing nothing at all.
  // The strongest thing a status can do, which is why both are short.
  if (status.frozen(u.statuses)) {
    u.action = "Idle";
    return;
  }

  // Airborne. Committed to the arc: it cannot steer, fight or be shoved
  // mid-jump, which is exactly the window that makes a river-jumper
  // answerable -- you can see it coming and it cannot turn back.
  if (u.leap) {
    u.leap.t += dt;
    const k = Math.min(1, u.leap.t / u.leap.dur);
    u.y = u.leap.fromY + (u.leap.toY - u.leap.fromY) * k;
    u.action = "Walk";
    if (k >= 1) u.leap = undefined;
    return;
  }

  // Forget a target that died or wandered out of reach.
  if (u.target && (u.target.dead || gapTo(u, u.target) > u.aggro * 1.4)) {
    u.target = undefined;
  }
  /*
   * Keep what you are fighting; keep looking while you are only walking to it.
   *
   * A target held from the moment it is chosen means a creature that locked a
   * tower from five tiles away walks *through* everything on the way -- seen
   * in a screenshot: an enemy passing within nothing of a defender, never
   * swinging, health untouched on both sides. Clash Royale locks on when a
   * troop is actually engaged, not while it is travelling, and the difference
   * is the whole feel of a lane.
   *
   * So: in range of the target, nothing pulls it off -- which is what stops a
   * Dugtrio mid-swing being yanked away by a poke. Out of range, it is still
   * shopping, and the nearest thing wins.
   */
  if (u.target && gapTo(u, u.target) > u.range) {
    const nearer = combat.findTarget(match, u, u.aggro);
    if (nearer && nearer !== u.target) u.target = nearer;
  }
  if (!u.target) u.target = combat.findTarget(match, u, u.aggro);

  if (u.target) {
    const d = gapTo(u, u.target);
    const tdx = u.target.x - u.x, tdy = u.target.y - u.y;

    if (d <= u.range) {
      u.action = u.range > 30 ? "Shoot" : "Attack";
      u.facing = facingFor(tdx, tdy);
      // Flinching: in range, facing the right way, and unable to swing. It is
      // the cheapest status to reason about and the harshest at close range,
      // which is why Bite's five seconds is the longest duration we import.
      if (status.has(u.statuses, "flinch")) return;
      if (u.cooldown <= 0) {
        u.cooldown = u.attackRate;
        const mult = combat.matchup(u, u.target);

        // Charged up: cast the signature ability instead of swinging.
        u.charge += 1;
        // Silenced: it still swings, it just cannot cast. The charge is held
        // rather than spent, so the move lands the moment the silence ends --
        // silence delays a cast, it does not delete one.
        if (u.charge >= u.castEvery && status.has(u.statuses, "silence")) {
          u.charge = u.castEvery;
        } else if (u.charge >= u.castEvery) {
          u.charge = 0;
          combat.castSkill(match, u, u.target, mult);
          return;
        }

        if (u.range > 30) {
          // Ranged damage rides the projectile, so it lands when the shot
          // does rather than the instant the trigger is pulled.
          // Scaled by how fast the shooter is, since one stat drives both.
          // Square-rooted so the spread stays inside a playable band: the
          // raw ratio runs 0.7x to 1.5x and doubles the difference between
          // the slowest and fastest shot, which is more than the mechanic
          // can carry.
          const shotSpeed = config.projectileSpeed
            * Math.sqrt(u.speed / (config.unitSize * 0.6));
          combat.launch(match, u, u.target, u.damage, mult, shotSpeed);
        } else {
          combat.applyHit(match, u.target, u.damage, mult, u);
        }
      }
      movement.pushOutOfTowers(match.towers, u);
      return;
    }

    // Close on the target, by way of a bridge if the water is in between.
    const wasY = u.y;
    const via = movement.wayTo(u, u.target.x, u.target.y);
    const vdx = via.x - u.x, vdy = via.y - u.y;
    const len = Math.max(0.001, span(vdx, vdy));
    u.action = "Walk";
    u.facing = facingFor(vdx, vdy);
    const sp = movement.speedOf(u);
    u.x += (vdx / len) * sp * dt;
    u.y += (vdy / len) * sp * dt;
    match.note("unit.move", "continuous", u.side, { id: u.id, x: u.x, y: u.y });
    // Both target branches used to return before match ran, so the wall only
    // existed for a unit with nothing to fight. Anything walking at a tower
    // -- which is every runner and every tank, by definition -- went through
    // it, and once in range it stood inside attacking and was never pushed
    // out again. A player watched a Yamper sit on the king tower to hit it.
    movement.pushOutOfTowers(match.towers, u);
    movement.keepOutOfRiver(u, wasY);
    return;
  }

  // Nothing to fight: head for the objective. Units used to move straight up
  // or down their lane and drift sideways only at the bridge, so two lanes
  // never met and a lane was a queue rather than a fight. Steering toward a
  // goal makes the path diagonal, which converges units on towers and on
  // each other.
  let goal = movement.goalFor(match.towers, u);

  // Support. A unit that is not itself a win condition falls in behind the
  // nearest friendly one heading the same way. Without match a "push" is
  // several creatures that happen to be moving at once: the tank arrives
  // alone, dies alone, and the support behind it never fought anything.
  if (u.targets.includes("troop")) {
    let lead: Unit | undefined;
    let leadD = Infinity;
    for (const o of match.units) {
      if (o === u || o.dead || o.side !== u.side || o.targets.includes("troop")) continue;
      const ahead = forwardFor(u.side) < 0 ? o.y < u.y : o.y > u.y;
      if (!ahead) continue;
      const d = dist(u.x, u.y, o.x, o.y);
      if (d < 110 && d < leadD) { lead = o; leadD = d; }
    }
    // Just behind it, not on top of it, so the tank still eats the hits.
    if (lead) goal = { x: lead.x, y: lead.y - forwardFor(u.side) * 22 };
  }

  let dx = goal.x - u.x, dy = goal.y - u.y;
  const len = Math.max(0.001, span(dx, dy));
  dx /= len; dy /= len;

  const wasY = u.y;
  const sep = movement.separation(match.units, u);
  const squeeze = movement.squeezePast(match.units, u, dx, dy);
  // The nudge is perpendicular to travel, so slipping past costs no forward
  // progress -- it should feel like threading a gap, not like a detour.
  const sp = movement.speedOf(u);
  u.x += (dx + sep.x + squeeze * -dy) * sp * dt;
  u.y += (dy + sep.y + squeeze * dx) * sp * dt;
  match.note("unit.move", "continuous", u.side, { id: u.id, x: u.x, y: u.y });

  movement.pushOutOfTowers(match.towers, u);
  // Crowding pushes sideways, so a unit queueing at a busy bridge can be
  // shoved off the planks. Without match the shove is a swim.
  movement.keepOutOfRiver(u, wasY);

  // Never walk off the sides.
  u.x = Math.max(8, Math.min(config.arenaWidth - 8, u.x));
  u.action = "Walk";
  u.facing = facingFor(dx, dy);
}

/**
 * Run a per-frame countdown, and land it exactly on zero.
 *
 * Every timer here is a repeated `-= dt`, and the frame it crosses zero it
 * lands on dust -- a few times ten-to-the-minus-seventeen either side. Compare
 * that with `> 0` and the answer depends on the last bit, which is how a king
 * finished waking one frame later in Java than in TypeScript, fired a frame
 * late, and left a blow missing from a match that was otherwise identical to
 * the bit. Clamping means both engines hold exactly zero afterwards and every
 * comparison downstream agrees.
 */
export function countdown(value: number, dt: number): number {
  const left = value - dt;
  return left <= 1e-9 ? 0 : left;
}

export function updateTower(
  match: Match,
  t: Tower, dt: number) {
  if (!t.active) return;
  if (t.waking > 0) {
    t.waking = countdown(t.waking, dt);
    match.note("tower.waking", "continuous", t.side, { id: t.id, left: t.waking });
    return;
  }

  // Reloading runs whether or not anything is in range, so a burst tower
  // that emptied itself into a dying swarm is dry when the next wave lands.
  // That gap is the archetype: it is what you bait, and what you punish.
  if (t.reloading > 0) {
    t.reloading = countdown(t.reloading, dt);
    match.note("tower.reloading", "continuous", t.side, { id: t.id });
    if (t.reloading <= 0 && t.volley) {
      t.ammo = t.volley.shots;
      match.note("tower.reloaded", "discrete", t.side, { id: t.id, ammo: t.ammo });
    }
    return;
  }
  if (t.cooldown > 0) { t.cooldown = countdown(t.cooldown, dt); return; }

  let best: Unit | undefined;
  let bestD = t.range;
  for (const u of match.units) {
    // Arriving is not being there -- the same rule every other targeting path
    // in the game already follows. Without it a tunneller was shot under the
    // ground and a Snorlax in mid-air: a card the player has not finished
    // placing cannot be answered, only sniped.
    if (u.side === t.side || u.dead || combat.arriving(u)) continue;
    const d = dist(t.x, t.y, u.x, u.y);
    if (d < bestD) { best = u; bestD = d; }
  }
  if (!best) return;

  t.cooldown = t.rate;
  match.note("tower.shoot", "discrete", t.side, { id: t.id, at: best.id });
  combat.launch(match, t, best, t.damage, 1, 260);

  if (t.volley && --t.ammo <= 0) t.reloading = t.volley.reload;
}

/** Start a king's wake-up. Harmless to call on one already awake. */
export function wakeKing(
  match: Match,
  t: Tower) {
  if (t.active || t.dead) return;
  t.active = true;
  t.waking = config.kingWakeSeconds;
  match.note("tower.kingWakes", "discrete", t.side, { id: t.id });
  match.events.push({ type: "kingWakes", tower: t });
}
