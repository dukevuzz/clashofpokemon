/** Where a creature is allowed to be, and how it gets there. */

import { config, forwardFor } from "./config";
import * as status from "./status";
import { CROWD_RADIUS, radiusOf, gapTo, boxOf, type Unit, type Tower } from "./match";
import { spreadFor } from "./spread";

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



/** Is this x over a crossing? */
export function onBridge(x: number): boolean {
  return config.bridgeX.some(
    (bx) => Math.abs(x - bx) <= config.bridgeHalfWidth,
  );
}

/** -1 above the water, +1 below it, 0 inside it. */
export function bankOf(y: number): number {
  const top = config.riverY - config.riverHeight / 2;
  const bot = config.riverY + config.riverHeight / 2;
  return y <= top ? -1 : y >= bot ? 1 : 0;
}

/** Keep anything that cannot swim out of the water. */
export function keepOutOfRiver(u: Unit, wasY: number) {
  if (config.riverBypass && u.flying) return;

  // A jumper does not wade in, it launches. Entering the water starts a leap
  // that carries it clear to the far bank over `config.leapTime`, so the
  // crossing is an event with a beginning and an end rather than a walk that
  // happens to be over water.
  if (config.riverBypass && u.jumpsRiver) {
    if (u.leap) return;
    const from = bankOf(wasY);
    // Not launched from solid ground, or has not reached the edge yet.
    // Reaching the water *is* the trigger, so this must not test for it the
    // way the walkers' branch does -- an earlier version returned on exactly
    // the condition it was waiting for, and no unit ever left the ground.
    if (from === 0 || bankOf(u.y) === from) return;
    // It has just stepped over the whole band in one frame -- only possible
    // for something very fast -- so put the leap back over the water it
    // skipped and let it play out properly.
    const top = config.riverY - config.riverHeight / 2;
    const bot = config.riverY + config.riverHeight / 2;
    u.y = from < 0 ? top : bot;
    u.leap = {
      t: 0, dur: config.leapTime,
      fromY: u.y, toY: from < 0 ? bot : top,
    };
    return;
  }
  if (bankOf(u.y) !== 0) return;
  if (onBridge(u.x)) return;

  const top = config.riverY - config.riverHeight / 2;
  const bot = config.riverY + config.riverHeight / 2;
  const from = bankOf(wasY);
  // Already in the water at the start of the frame -- only possible on the
  // first frame after a drop -- so the nearer bank is the only sensible
  // answer.
  if (from === 0) {
    u.y = u.y - top < bot - u.y ? top : bot;
    return;
  }
  u.y = from < 0 ? top : bot;
}

/** Steer a walk around the water. */
export function wayTo(u: Unit, tx: number, ty: number): { x: number; y: number } {
  if (config.riverBypass && (u.flying || u.jumpsRiver)) return { x: tx, y: ty };
  const here = bankOf(u.y);
  const there = bankOf(ty);
  // Same side, or the target is standing on the bridge itself.
  if (here === there || there === 0) return { x: tx, y: ty };

  const bx = config.bridgeX[u.lane];
  const top = config.riverY - config.riverHeight / 2;
  const bot = config.riverY + config.riverHeight / 2;

  // Already out on the planks, so the only thing left is the far bank. This
  // case has to be read off the *target's* side rather than the unit's,
  // because a unit standing in the water has no side of its own -- treating
  // "not above the water" as "below it" sent every enemy unit that reached
  // the middle of a bridge back the way it came.
  if (here === 0) return { x: bx, y: there < 0 ? top : bot };

  // Line up with the planks *before* closing on the water, then cross.
  //
  // The staging point is short of the bank, not on it. Aiming at the mouth
  // itself put both the unit and its target on opposite sides of nothing: the
  // straight line from a drop point out in the field to a point *on* the
  // waterline reaches the water first and the bridge second, so the unit was
  // stopped by `keepOutOfRiver` partway along and scraped sideways up the bank
  // until it happened to arrive. A player described it exactly -- "they go
  // straight until blocked by water, then move a bit left".
  //
  // With the staging point held clear of the bank, both ends of the path are on
  // the same side, so no part of the line can cross the water. The unit walks a
  // clean diagonal to the bridge, then turns and goes over.
  const onIt = Math.abs(u.x - bx) <= config.bridgeHalfWidth * 0.6;
  if (onIt) return { x: bx, y: here < 0 ? bot : top };
  const stage = config.bridgeApproach;
  return { x: bx, y: here < 0 ? top - stage : bot + stage };
}

/** Where a unit is trying to get to. */
export function goalFor(towers: Tower[], u: Unit): { x: number; y: number } {
  const forward = forwardFor(u.side);
  // Against the actual bank, not a fixed 12 units either side of the middle.
  // That offset was written when the river was 48 deep, so +/-12 sat safely
  // inside the far half; widen the water and the same number lands *in* it,
  // and a unit standing in the river counted itself across.
  const crossed = bankOf(u.y) === (forward < 0 ? -1 : 1);

  const bypasses = config.riverBypass && (u.flying || u.jumpsRiver);
  if (!bypasses && !crossed) {
    // The bridge's own x, not the lane's. They differ by five units and the
    // crossing test is against the bridge, so aiming at the lane walked a
    // unit at a point five units off the planks it has to be standing on.
    const bx = config.bridgeX[u.lane];
    const bank = config.riverHeight / 2 + 2;

    // Line up with the planks on *this* side before aiming across.
    //
    // Aiming straight at the far bank makes the path a diagonal from open
    // field to a point beyond the water, and that line meets the river well
    // before it meets the bridge. `keepOutOfRiver` then stops the unit dead
    // and it scrapes sideways along the bank until it stumbles onto the
    // planks. A player described it exactly: "they go straight until blocked
    // by water, then move a bit left".
    //
    // Staging on the near side first keeps both ends of the path on the same
    // bank, so no part of it can touch water. The unit walks a clean diagonal
    // to the bridge mouth, then turns and crosses.
    const lined = Math.abs(u.x - bx) <= config.bridgeHalfWidth * 0.6;
    if (!lined) {
      return { x: bx, y: config.riverY - forward * (bank + config.bridgeApproach) };
    }
    return { x: bx, y: config.riverY + forward * bank };
  }

  // A unit is committed to the lane it crossed in, and the only thing behind
  // a fallen lane tower is the king.
  //
  // Picking the nearest tower instead sent a unit diagonally across the board
  // the moment its own lane's tower fell: with the right tower gone, the
  // nearest standing one is the left tower, so a runner sent up the right
  // lane walked to the left. A player caught it and diagnosed it exactly --
  // "the right tower isn't there, so it finds the nearest tower and goes
  // left". Clash Royale commits a troop to its lane for precisely this
  // reason: breaking a tower has to open a path to the king, not redirect
  // everything you own into the lane that is still defended.
  const enemyTowers = towers.filter((t) => t.side !== u.side && !t.dead);
  let best =
    enemyTowers.find((t) => t.kind === "side" && (t.x < config.arenaWidth / 2 ? 0 : 1) === u.lane) ??
    enemyTowers.find((t) => t.kind === "king");
  if (!best) {
    // Only if this side's lane tower and the king are both gone -- the match
    // is already over in that case, but pathing must not return nothing.
    let bestD = Infinity;
    for (const t of enemyTowers) {
      const d = gapTo(u, t);
      if (d < bestD) { best = t; bestD = d; }
    }
  }
  if (!best) return { x: u.x, y: u.y + forward * 100 };

  // Aim at the near face rather than the middle, so arriving means standing
  // against the wall instead of walking to the centre of the building.
  const dx = best.x - u.x, dy = best.y - u.y;
  const len = Math.max(0.001, span(dx, dy));
  const stand = radiusOf(best) + 6;
  return {
    x: best.x - (dx / len) * stand,
    y: best.y - (dy / len) * stand,
  };
}

/** A small push away from neighbours, friendly or not. */
export function separation(units: Unit[], u: Unit): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (let i = 0; i < units.length; i++) {
    const o = units[i];
    if (o === u || o.dead || o.flying !== u.flying) continue;
    // Underground is not on the board. A digger passing beneath a crowd must
    // not shove it aside -- unlike a landing Snorlax, which is a rock and is
    // meant to be one.
    if (o.digTo && o.spawning > 0) continue;
    // A unit still landing is a rock: it cannot be shoved, and shoving it
    // would let a player place one and immediately barge it forward.
    const dx = u.x - o.x, dy = u.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= CROWD_RADIUS * CROWD_RADIUS) continue;

    // Mass decides who moves. Two equal creatures share the push; a Caterpie
    // meeting an Onix does all the moving. Without this, separation was
    // symmetric and a heavy unit got jostled off its line by anything that
    // walked into it.
    const share = o.spawning > 0
      ? 1
      : (o.mass) / (u.mass + o.mass);

    if (d2 < 0.01) {
      // Exactly coincident, the normal case for a card that spawns several
      // bodies. There is no direction to push along, so give each a fixed
      // bearing off its index -- read from a table rather than computed, so
      // that the two engines agree bit for bit. See spread.ts.
      const [bx, by] = spreadFor(i);
      sx += bx * 0.8;
      sy += by * 0.8;
    } else {
      const d = Math.sqrt(d2);
      const push = ((CROWD_RADIUS - d) / CROWD_RADIUS) * 1.6 * share;
      sx += (dx / d) * push;
      sy += (dy / d) * push;
    }
  }
  return { x: sx, y: sy };
}

/** Squeeze past a slower friendly unit directly ahead. */
export function squeezePast(units: Unit[], u: Unit, dirX: number, dirY: number): number {
  let nudge = 0;
  for (const o of units) {
    if (o === u || o.dead || o.flying !== u.flying) continue;
    if (o.side !== u.side) continue;          // enemies are fought, not passed
    if (o.speed >= u.speed) continue;         // nothing to gain

    const dx = o.x - u.x, dy = o.y - u.y;
    const d = span(dx, dy);
    if (d > 26 || d < 0.01) continue;
    // Only what is actually in front, along the direction of travel.
    if ((dx * dirX + dy * dirY) / d < 0.7) continue;

    const speedEdge = Math.min(1, (u.speed - o.speed) / Math.max(1, o.speed));
    const massEdge = u.mass / (u.mass + o.mass);
    // Around whichever side it is already closer to.
    const side = dx >= 0 ? -1 : 1;
    nudge += side * speedEdge * massEdge * 1.4;
  }
  return nudge;
}

/** Towers are solid. */
export function pushOutOfTowers(towers: Tower[], u: Unit) {
  // Fliers pass over. That is the whole advantage of flying, and it is also
  // why a flier can sit on a tower and hit it from directly above.
  if (u.flying) return;

  for (const t of towers) {
    if (t.dead) continue;
    const r = radiusOf(t) + 4;
    const box = boxOf(t);
    const dx = u.x - t.x, dy = u.y - t.y;
    // The shape the tower is actually drawn as: a rectangle, taller than it
    // is wide, and not centred on the tower's own position.
    //
    // This tested `hypot(dx, dy) < r` -- a circle inscribed in the footprint
    // -- so the corners were legal standing room, and then a square the width
    // of the footprint, which still left the whole staircase free. Both times
    // a player saw creatures standing on the stonework.
    if (Math.abs(dx) >= r) continue;
    if (dy < -box.up || dy > box.down) continue;

    // Sideways, not backwards.
    //
    // Pushing radially -- straight back the way it came -- froze any unit
    // that had to walk past its own tower: it stepped forward into the
    // footprint, got shoved back out, and repeated that forever. A unit
    // deployed behind its own lane tower never moved again.
    //
    // Leaving by the nearest *side* lets it walk around, which is what a
    // creature meeting a building would actually do.
    // Out to the nearest vertical face, whatever the y. Solving the circle
    // instead -- sideways to `sqrt(r^2 - dy^2)` -- collapses to nothing near
    // the top and bottom of the footprint and leaves the unit on the tower.
    const side = dx >= 0 ? 1 : -1;
    const target = t.x + side * r;

    // Unless going around would put it off the board, in which case the far
    // side is the only way through.
    u.x = target < 8 || target > config.arenaWidth - 8
      ? t.x - side * r
      : target;
    u.x = Math.max(8, Math.min(config.arenaWidth - 8, u.x));
  }
}

/** Movement speed after whatever is afflicting it. */
export function speedOf(u: Unit): number {
  return status.has(u.statuses, "paralysis")
    ? u.speed * status.PARALYSIS_SPEED
    : u.speed;
}
