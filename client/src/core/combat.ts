/** Landing a hit: who gets picked, how much it takes off, and what it leaves behind. */

import { config, forwardFor } from "./config";
import { typeMultiplier } from "./species";
import * as tiers from "./tiers";
import * as status from "./status";
import * as skills from "./skills";
import * as tick from "./tick";
import { gapTo, type Match, type Thing, type Unit, type Tower } from "./match";

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


/** Towers are structures, not creatures: they have no typing, so nothing is strong or weak against them. */
/**
 * Is this unit still on its way in?
 *
 * A tolerance, not `> 0`, and the reason is worth keeping. `spawning` counts
 * down by a fixed dt, so on the frame it runs out it lands on float dust --
 * measured at -3.5e-16 -- and whether that dust is above or below zero depends
 * on the last bit of `arrivalTime`, which V8 and the JVM do not compute
 * identically. Ask `> 0` and the two engines disagree about whether a tower
 * may fire on that one frame, which is exactly how a single missing blow
 * turned up in the differential suite.
 *
 * A nanosecond is a hundred-millionth of a frame: far too small to change what
 * anybody sees, far too large for rounding to reach.
 */
export const ARRIVING = 1e-9;

export const arriving = (u: { spawning: number }): boolean => u.spawning > ARRIVING;

export function matchup(attacker: Thing, target: Thing): number {
  const a = "card" in attacker ? attacker.card.sheet : undefined;
  const d = "card" in target ? target.card.sheet : undefined;
  if (!a || !d) return 1;
  return typeMultiplier(a, d);
}

/** Closest enemy thing worth hitting. */
export function findTarget(
  match: Match,
  u: Unit, radius: number): Thing | undefined {
  let best: Thing | undefined;
  let bestD = radius;

  // Charmed: it goes for whoever charmed it, and nothing else.
  //
  // Distinct from confusion, which scatters attention -- charm focuses it on
  // the wrong thing. It reads the id off the status rather than a field on
  // the unit so a second charm cannot silently overwrite the first's source.
  const ch = u.statuses.find((x) => x.kind === "charm" && x.by !== undefined);
  if (ch) {
    const by = match.units.find((o) => o.id === ch.by && !o.dead);
    if (by) return by;
  }

  // Confused: it fights something in reach, but not the something it should.
  //
  // Picking a random target in range rather than the nearest is the cheapest
  // honest reading of confusion, and it is the one that stays inside the
  // rules -- a confused unit is still hostile, still committed to its lane,
  // and still cannot hit what its targets list forbids. The alternative, PAC's
  // erratic movement, would fight the river and tower collision this game
  // spent a session getting right.
  if (status.has(u.statuses, "confusion")) {
    const near: Thing[] = [];
    if (u.targets.includes("troop")) {
      for (const o of match.units) {
        if (o.side === u.side || o.dead || arriving(o)) continue;
        if (dist(u.x, u.y, o.x, o.y) < radius) near.push(o);
      }
    }
    for (const t of match.towers) {
      if (t.side === u.side || t.dead) continue;
      if (gapTo(u, t) < radius) near.push(t);
    }
    if (near.length) return near[Math.floor(match.rng() * near.length)];
    return undefined;
  }

  // Only what this unit is willing to fight. "Can I attack that? If not, go
  // to the one I can" -- so a building-only card walks on rather than
  // stopping, without needing a separate concept for ignoring things.
  if (u.targets.includes("troop")) {
    const forward = forwardFor(u.side);
    // A full circle filters nothing, and saying so outright beats relying on
    // cos(180°) being exactly -1 in two languages. `dy / d` for something
    // directly behind lands on -1 in one engine and a hair below it in the
    // other -- V8's Math.hypot and the JVM's are both approximate and not the
    // same approximation -- so the two disagreed about whether a unit right
    // behind another could be seen. Unreachable while the arc was a cone;
    // the normal case once it is a circle.
    const wholeCircle = config.aggroArc >= 180;
    const minCos = Math.cos((config.aggroArc * Math.PI) / 180);
    for (const o of match.units) {
      // Still arriving is not yet on the board. A tunneller surfacing, a thrown
      // ball mid-arc and a Snorlax falling were all attackable before they had
      // landed -- and a card the player has not finished placing cannot be
      // answered, only sniped.
      if (o.side === u.side || o.dead || arriving(o)) continue;
      const dx = o.x - u.x, dy = o.y - u.y;
      const d = span(dx, dy);
      if (d >= bestD) continue;
      // Only what is in front or beside. `forward` is the way this side
      // marches, and the board is walked along y, so the cosine of the angle
      // off that line is simply the normalised forward component.
      if (!wholeCircle && d > 0.001 && (dy * forward) / d < minCos) continue;
      best = o; bestD = d;
    }
  }
  /*
   * Towers are measured centre to centre here, like creatures.
   *
   * `gapTo` measures to the edge of a tower's box, which is right for deciding
   * whether you can *hit* it and wrong for deciding what to go for: a tower a
   * tile away read as nearer than a defender two tiles away, so attackers
   * walked past the creature sent to stop them. Reported twice from play.
   *
   * Two special cases were tried before this and both were worse. Preferring
   * creatures outright made a creature standing against a tower turn round and
   * walk five tiles away. Preferring the tower when it was within attack range
   * made long-ranged creatures behave differently from short-ranged ones for
   * no reason a player could see.
   *
   * One rule, measured the same way for everything: the nearest thing wins.
   */
  for (const t of match.towers) {
    if (t.side === u.side || t.dead) continue;
    const d = span(t.x - u.x, t.y - u.y);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

/** The one place damage is applied, so a hit can never land without the player being told why it landed as hard as it did. */
export function applyHit(
  match: Match,
  target: Thing, amount: number, mult: number,
  source: Unit | Tower, resist: tiers.Resist = "physical",
): number {
  let armour =
    resist === "special" ? (target.speDef ?? 0)
    : resist === "none" ? 0
    : (target.def ?? 0);
  // Broken armour is meaningful here precisely because this function already
  // picks a defence off `resist`: the status weakens whichever one the
  // incoming attack was going to be reduced by, rather than a single generic
  // number that would make physical and special attacks interchangeable.
  if (!target.isTower && status.has(target.statuses, "armorBreak")) {
    armour *= 1 - status.ARMOR_BREAK;
  }

  const dealt = Math.round(tiers.mitigate(amount * mult, armour));

  // A shield soaks first, and what it cannot cover carries through to health.
  // Applied after mitigation, so armour still counts: a shield is extra health,
  // not immunity, and stacking it in front of armour would make one card's
  // buff worth more on a tank than the tank's own armour.

  // Being hit wakes you, the way it does in the games. Without this a sleep
  // is a two-second execution rather than a two-second reprieve for whoever
  // cast it.
  if (!target.isTower && dealt > 0) status.wake(target.statuses);

  let through = dealt;
  if (!target.isTower && (target as Unit).shield > 0) {
    const soaked = Math.min((target as Unit).shield, through);
    (target as Unit).shield -= soaked;
    through -= soaked;
    match.note("unit.shieldSoak", "discrete", target.side, {
      id: target.id, soaked, left: (target as Unit).shield,
    });
  }
  target.hp -= through;
  match.note("thing.hit", "discrete", target.side, {
    id: target.id, dealt, mult, hp: target.hp, from: source.id,
  });
  match.events.push({ type: "hit", target, amount: dealt, mult, source });

  /*
   * Hit me while I have nothing to hit, and I will look at you.
   *
   * Only then. This used to pull a creature off a *tower* as well, which is
   * why a Dugtrio mid-swing at a crown tower would turn round and chase
   * whatever poked it -- reported from play, and against the rule: a target is
   * kept until it dies or leaves reach.
   *
   * It existed because awareness was a 220-degree cone and something shooting
   * from behind was otherwise unanswerable. The arc is a full circle now, so
   * the next time this creature has no target it will find the nearest thing
   * by itself, whichever side of it that is. Nothing has to be yanked.
   */
  if (!target.isTower && target.targets.includes("troop") && !source.isTower) {
    if (!target.target) {
      target.target = source;
      match.note("unit.retarget", "local", target.side, {
        id: target.id, to: source.id,
      });
    }
  }

  // A king that is being hit stops sleeping through it.
  if (target.isTower && target.kind === "king") tick.wakeKing(match, target);

  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    match.note("thing.death", "discrete", target.side, {
      id: target.id, tower: Boolean(target.isTower),
    });
    match.events.push({ type: "death", thing: target });
    if (target.isTower) {
      match.note("tower.down", "discrete", target.side, {
        id: target.id, kind: target.kind,
      });
      match.events.push({ type: "towerDown", tower: target });
      // Losing a lane tower wakes the king behind it.
      if (target.kind === "side") {
        for (const t of match.towers) {
          if (t.side === target.side && t.kind === "king") tick.wakeKing(match, t);
        }
      }
    }
  }
  return dealt;
}

/** Put a move's status on whatever it hit. */
export function afflict(
  match: Match,
  target: Thing, skill: string | undefined, by?: Unit) {
  if (!skill || target.isTower || target.dead) return;
  const effect = status.MOVE_STATUS[skill];
  if (!effect) return;
  if (effect.chance < 1 && match.rng() >= effect.chance) return;
  status.apply(target.statuses, effect.kind, effect.seconds, by?.id);
  match.note("status.apply", "discrete", target.side, {
    id: target.id, kind: effect.kind, seconds: effect.seconds,
  });
  match.events.push({
    type: "status", unit: target, kind: effect.kind, seconds: effect.seconds,
  });
}

/** The special: bigger damage on the target, splash on everything near it. */
export function castSkill(
  match: Match,
  u: Unit, target: Thing, mult: number) {
  match.note("unit.cast", "discrete", u.side, {
    id: u.id, skill: u.card.skill, at: target.id,
  });
  match.events.push({ type: "cast", unit: u, target, skill: u.card.skill });

  // A move that is not an attack is not made into one.
  //
  // Teleport is an escape, Wish is a heal, Agility is a speed buff -- and all
  // three used to resolve as "hit the target, splash the crowd for half",
  // because PAC records no damage figure for them and the fallback is damage.
  // Fourteen of 57 cards cast the same effect under different names.
  const effect = skills.MOVE_EFFECT[u.card.skill ?? ""];
  if (effect) {
    // Both the heal and the shield look for company; everything else is self.
    const wantsAllies = effect.kind === "heal" || effect.kind === "shield";
    const allies = wantsAllies
      ? match.units.filter((o) =>
          o.side === u.side && !o.dead &&
          dist(u.x, u.y, o.x, o.y) <= config.skillRadius)
      : [];
    skills.applyEffect(match, match.towers, u, allies.length ? allies : [u], effect);
    return;
  }

  // Six of our moves have no figure in PAC's table and are not generic at all:
  // Iron Tail and Rollout hit for their own defence, Body Slam for its own max
  // health, Foul Play for the target's attack. See skills.POWERED.
  const powered = skills.poweredDamage(
    u.card.skill, u, target.isTower ? undefined : (target as Unit));

  const { amount: base, resist } = tiers.skillDamage(
    { skill: u.card.skill, stage: u.card.stage, damage: u.damage },
    u.damage * config.skillDamage,
    // Moves that hit with the body read armour, not special defence. Without
    // this they fall back to `special` and an Onix's 20 def counts for nothing.
    // PAC declares every one of our undeclared moves SPECIAL. An earlier
    // version forced four of them physical, reasoning from the move's name.
    undefined,
  );
  const amount = powered ?? base;
  applyHit(match, target, amount, mult, u, resist);
  afflict(match, target, u.card.skill, u);

  for (const o of match.units) {
    if (o.side === u.side || o.dead || o === target || arriving(o)) continue;
    if (dist(target.x, target.y, o.x, o.y) <= config.skillRadius) {
      applyHit(match, o, amount * 0.5, matchup(u, o), u, resist);
      // Everything the splash touches, not only what was aimed at. A move
      // that paralyses paralyses the crowd it lands in, which is most of what
      // makes an area move worth casting into one.
      afflict(match, o, u.card.skill, u);
    }
  }
}

/** Put a shot in the air, and tell the renderer to draw it travelling. */
export function launch(
  match: Match,
  source: Unit | Tower, target: Thing,
  amount: number, mult: number, speed: number,
) {
  match.projectiles.push({
    x: source.x, y: source.y - 8, target,
    tx: target.x, ty: target.y - 6,
    amount, mult, source, speed,
  });
  match.note("shot.launch", "discrete", source.side, {
    from: source.id, at: target.id, amount, speed,
  });
  match.events.push({ type: "shot", from: source, to: target, amount, mult });
}

/** Advance every shot, and apply it where it lands. */
export function updateProjectiles(
  match: Match,
  dt: number) {
  for (let i = match.projectiles.length - 1; i >= 0; i--) {
    const p = match.projectiles[i];
    if (!p.target.dead) {
      p.tx = p.target.x;
      p.ty = p.target.y - 6;
    }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = span(dx, dy);
    const stepLen = p.speed * dt;

    if (d <= stepLen) {
      match.projectiles.splice(i, 1);
      match.note("shot.land", "discrete", p.source.side, {
        at: p.target.id, hit: !p.target.dead,
      });
      if (!p.target.dead) applyHit(match, p.target, p.amount, p.mult, p.source);
    } else {
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
      match.note("shot.move", "continuous", p.source.side, { x: p.x, y: p.y });
    }
  }
}
