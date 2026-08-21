/** Putting a card on the board: where it may go, whether you can afford it, and what appears when you do. */

import { config, forwardFor, type Side } from "./config";
import { arrivesAnywhere, type Card } from "./cards";
import * as hand from "./hand";
import { CROWD_RADIUS, boxOf, type Match, type Unit } from "./match";

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



/** `anywhere` is about *legality* -- may this card land in their half. */
/**
 * The furthest forward this side may drop, at this x.
 *
 * The halfway line, unless that lane's tower has fallen -- then it is the near
 * edge of where the tower stood. Their doorstep, not their throne room.
 */
function frontLine(match: Match, side: Side, x: number): number {
  const forward = forwardFor(side);
  const half = config.arenaHeight / 2;
  const ownHalf = forward < 0
    ? half + config.deployMargin
    : half - config.deployMargin;

  const lane = x < config.arenaWidth / 2 ? 0 : 1;
  const broken = match.towers.find(
    (t) => t.side !== side && t.kind === "side" && t.dead &&
      (t.x < config.arenaWidth / 2 ? 0 : 1) === lane,
  );
  if (!broken) return ownHalf;
  return broken.y - forward * boxOf(broken).up;
}

export function nearestDeploy(
  match: Match,
  side: Side, x: number, y: number, approachX = x, anywhere = false,
  delivered = anywhere,
): { x: number; y: number } {
  const half = config.arenaHeight / 2;
  const forward = forwardFor(side);

  x = Math.min(Math.max(x, 7), config.arenaWidth - 7);
  y = Math.min(Math.max(y, 7), config.arenaHeight - 7);

  // Forward to the line this side may actually reach, which is not always
  // the halfway line: breaking an enemy lane tower moves it up.
  //
  // This used to ask whether the *exact* drop was legal and, if not, snap all
  // the way home. So after breaking a tower, a drop twenty pixels too deep
  // jumped a hundred and seventy pixels backwards into your own half -- and
  // the reward for taking a tower looked like it had never been granted.
  // Clamping to the line puts the card at the front of what was won.
  if (!anywhere) {
    const line = frontLine(match, side, x);
    y = forward < 0 ? Math.max(y, line) : Math.min(y, line);
  }

  // Off any tower, toward the side the drag came from. A unit dropped inside
  // stonework is shoved out every frame, and an earlier build froze units
  // solid that way.
  for (const t of match.towers) {
    if (t.dead) continue;
    // Same rectangle the physics uses, or a card dropped on the steps lands
    // inside the stonework and is shoved out on its first frame.
    const box = boxOf(t);
    const clear = config.towerSize[t.kind] * 0.5 + config.unitSize * 0.6;
    const m = config.unitSize * 0.6;
    const dy = y - t.y;
    if (Math.abs(x - t.x) >= clear) continue;
    if (dy <= -box.up - m || dy >= box.down + m) continue;

    // A dragged card leaves by the side the finger came from; everything else
    // leaves by its nearest face.
    //
    // Both properties are worth having and they belong to different gestures.
    // A drag has a direction, and honouring it makes placement predictable --
    // pull in from the right and the card lands right, every time. A tap has no
    // direction at all, and a delivery has no approach: for those, "the side
    // your finger came from" is meaningless and the only sensible answer is the
    // nearest legal face.
    //
    // Gated on `delivered` alone, this used to shove *every* walked-in card
    // sideways. A player tapping just below their own tower watched the card
    // land 46 units across the lane -- most of two bodies -- when stepping a few
    // units further down was legal and nearer.
    // Where you released, not where you started.
    //
    // This used to lean on `approachX` -- the point the drag began -- whenever
    // the gesture was a drag, so pulling a card from the hand at the bottom
    // left and releasing it on the *right* of a tower pushed it out to the
    // left. A player put it plainly: "if I set it on the right side of tower
    // but then it spawn at left?". Clash Royale places where you let go, and so
    // should this.
    //
    // The approach only decides a genuine tie: a release dead on the tower's
    // centre line has no side of its own, and then the direction the finger
    // came from is the only information available.
    // Both axes. Centred on x alone counts a release directly *above* the tower
    // as ambiguous, when the obvious answer is to step up -- the release said
    // "above", and only a point sitting on the tower's middle says nothing.
    const centred = Math.abs(x - t.x) < 2 && Math.abs(y - t.y) < 2;

    // Everything leaves by its nearest face.
    //
    // This was gated on `delivered`, so only a thrown or dropped card got it
    // and an ordinary one was always shoved sideways. The reasoning was that a
    // vertical shove could carry a walked-in card over the river into a half
    // this side may not use -- true, and already handled: the bounds below are
    // computed from exactly that rule, so a vertical exit is only ever offered
    // where it is legal.
    if (!centred) {
      // A drop is delivered but still own-half only, so a vertical exit must
      // not be allowed to carry it over the line the legality check above
      // just enforced. Bound the vertical options rather than fixing it up
      // afterwards, or the "nearest face" chosen is one that is not legal.
      const limit = anywhere || laneOpen(match, side, x, y)
        ? { lo: 7, hi: config.arenaHeight - 7 }
        : forward < 0
          ? { lo: half + config.deployMargin, hi: config.arenaHeight - 7 }
          : { lo: 7, hi: half - config.deployMargin };
      const outs: Array<[number, number, number]> = [
        [x - (t.x - clear), t.x - clear, y],          // left
        [t.x + clear - x, t.x + clear, y],            // right
        [y - (t.y - box.up - m), x, t.y - box.up - m], // up
        [t.y + box.down + m - y, x, t.y + box.down + m], // down
      ];
      outs.sort((a, b) => a[0] - b[0]);
      const fit = outs.find(([, nx, ny]) =>
        nx >= 7 && nx <= config.arenaWidth - 7 &&
        ny >= limit.lo && ny <= limit.hi);
      if (fit) { x = fit[1]; y = fit[2]; }
      continue;
    }

    // Dead centre, or no legal face: the release tells us nothing, so fall back
    // to the direction the finger travelled. A delivery has no finger.
    const from = delivered ? x : approachX;
    const side_ = from <= t.x ? -1 : 1;
    const want = t.x + side_ * clear;
    x = want < 7 || want > config.arenaWidth - 7 ? t.x - side_ * clear : want;
  }

  return { x, y };
}

export function canDeploy(
  match: Match,
  side: Side, slot: number, x: number, y: number): boolean {
  const card = match.hand[side][slot];
  if (!card) return false;
  if (match.elixir[side] < hand.costOf(match, side, card)) return false;

  // Inside the board on every side. The vertical bound is not symmetry for
  // its own sake: without it a drop below the arena passed the "own half"
  // test, spent the elixir and spawned a unit past the despawn line, which
  // update() deletes on the same frame. The card vanished and nothing ever
  // walked out.
  if (x < 6 || x > config.arenaWidth - 6) return false;
  if (y < 6 || y > config.arenaHeight - 6) return false;

  // Tunnelling and throwing both put the card where you point; a drop does
  // not, and falls through to the own-half rule below.
  if (arrivesAnywhere(card.delivery)) return true;

  // Own half only -- this is what stops a match being decided by dropping
  // units on the enemy king -- unless you have earned the ground.
  const half = config.arenaHeight / 2;
  const ownHalf =
    side === config.PLAYER ? y >= half + config.deployMargin : y <= half - config.deployMargin;
  if (ownHalf) return true;

  // Breaking a lane tower opens that lane's half of their side. It is the
  // reward that makes a first tower worth more than the crown it is worth:
  // the next push starts at their doorstep instead of at yours.
  return laneOpen(match, side, x, y);
}

/** Has this side broken the enemy lane tower covering the half of the board that `x` falls in? */
export function laneOpen(
  match: Match,
  side: Side, x: number, y: number): boolean {
  const lane = x < config.arenaWidth / 2 ? 0 : 1;
  const broken = match.towers.find(
    (t) => t.side !== side && t.kind === "side" && t.dead &&
      (t.x < config.arenaWidth / 2 ? 0 : 1) === lane,
  );
  if (!broken) return false;

  // As deep as the tower you broke, and no deeper.
  //
  // This used to open that lane's whole column of their half, right to their
  // back edge -- so a first tower let you stand beside their king for the
  // rest of the match. Clash Royale's opened area stops well short of that,
  // and it is the difference between a reward and a win button: you have
  // earned their doorstep, not their throne room.
  const forward = forwardFor(side);
  const limit = broken.y - forward * boxOf(broken).up;
  return forward < 0 ? y >= limit : y <= limit;
}

export function deploy(
  match: Match,
  side: Side, slot: number, x: number, y: number, form?: string): boolean {
  if (!canDeploy(match, side, slot, x, y)) {
    match.note("deploy.refuse", "discrete", side, { slot, x, y });
    return false;
  }
  const held = match.hand[side][slot]!;
  match.note("deploy.play", "discrete", side, { slot, card: held.id, x, y, form });
  // A body chosen as part of this deployment rather than staged before it.
  //
  // Both spellings exist because they answer to different things. The screen
  // stages a choice in `match.form` as you cycle the card, and reads it back to
  // draw the ghost you are about to drop. A deploy arriving over a wire has no
  // such conversation -- it is one self-describing message, so it carries the
  // body with it and there is nothing to race against. `chooseForm` validates
  // either way, so a body the card does not offer is refused, not stored.
  if (form !== undefined) {
    hand.chooseForm(match, side, held, form);
    match.note("form.set", "discrete", side, { form, card: held.id });
  }
  const cost = hand.costOf(match, side, held);
  match.elixir[side] -= cost;
  match.note("elixir.spend", "discrete", side, { cost, to: match.elixir[side] });

  // Ditto puts down what you played last, not itself. The copy is the real
  // card in every other respect -- it evolves the original's play counter,
  // spawns the original's body count, and is what `lastPlayed` stays as, so
  // a second Ditto copies the same thing rather than copying a Ditto.
  // Ditto copies; Deoxys picks a body. Both resolve the card that is actually
  // placed from the one sitting in the hand, and neither changes the hand.
  const card = hand.formOf(match, side, hand.copyTarget(match, side, held) ?? held);

  // A card can put several bodies on the board; spread them so they do not
  // occupy the same point.
  for (let i = 0; i < card.count; i++) {
    const offset = (i - (card.count - 1) / 2) * CROWD_RADIUS;
    spawn(match, card, side, x + offset, y);
  }

  if (!held.copies) {
    match.lastPlayed[side] = card;
    match.note("hand.lastPlayed", "local", side, { card: card.id });
  }
  // The choice is per play. Leaving it set would silently apply to the next
  // Deoxys as well, which is exactly the decision this card exists to ask.
  match.form[side] = undefined;
  match.note("form.clear", "local", side);
  hand.countPlay(match, side, card);
  // Always draw, even when the play was the one that evolved the card.
  //
  // This used to skip the draw if the slot no longer held what was played --
  // which is exactly what an evolution does, since `replaceCard` swaps it in
  // place. So the evolving play handed you Charmeleon *and* let you keep your
  // slot: a free rotation on top of a free stat increase, invisible on screen
  // and impossible to plan around.
  //
  // Now the evolved card goes back into the cycle like everything else and
  // comes round in its turn. `drawFromDeck` skips whatever is already in hand,
  // so this deals the next card rather than the one just evolved.
  hand.drawFromDeck(match, side, slot);
  match.note("hand.draw", "discrete", side, {
    slot, card: match.hand[side][slot]?.id,
  });
  return true;
}

/** How long this card takes to arrive here. */
/**
 * Where a side's king stands.
 *
 * Derived from the config rather than read off the match, so arrival timing
 * stays a pure function of the card and the board -- the same answer whether
 * you ask it from the rules, the renderer or a tool.
 */
export function kingSpot(side: Side): { x: number; y: number } {
  return {
    x: config.arenaWidth / 2,
    y: side === config.PLAYER
      ? config.arenaHeight - config.towerBackOff.king
      : config.towerBackOff.king,
  };
}

export function arrivalTime(card: Card, side: Side, y: number, x?: number): number {
  if (card.delivery === "tunnel") {
    // A dig is a journey, so it is priced by how far it goes. Floored, so a
    // hole opened next to your own king still takes a moment rather than
    // reading as a teleport.
    const from = kingSpot(side);
    const dug = span((x ?? from.x) - from.x, y - from.y) / config.tunnelSpeed;
    return Number(Math.max(config.deliveryTime.tunnel, dug).toFixed(2));
  }
  if (card.delivery !== "throw") return card.deployDelay;
  const from = side === config.PLAYER ? config.arenaHeight : 0;
  const flight = Math.abs(y - from) / config.throwSpeed;
  return Number(Math.max(config.throwMinTime, flight).toFixed(2));
}

export function spawn(
  match: Match,
  card: Card, side: Side, x: number, y: number): Unit {
  /*
   * A tunneller starts at its own king and travels to where you put it.
   *
   * Clash Royale's Miner, and the reason the card feels like anything at all:
   * the journey is the cost, being untouchable during it is the payoff, and
   * both are visible to the person you are digging towards.
   */
  const digs = card.delivery === "tunnel";
  const start = digs ? kingSpot(side) : { x, y };

  const u: Unit = {
    id: match.nextId++, card, side, x: start.x, y: start.y,
    hp: card.hp, maxHP: card.hp,
    damage: card.damage, range: card.range, aggro: card.aggro,
    speed: card.speed, attackRate: card.attackRate, cooldown: 0,
    dead: false, charge: 0, castEvery: card.castEvery,
    targets: card.targets, jumpsRiver: card.jumpsRiver, statuses: [],
    flying: card.flying, def: card.def, speDef: card.speDef, shield: 0,
    lane: x < config.arenaWidth / 2 ? 0 : 1,
    mass: card.mass,
    facing: side === config.PLAYER ? 4 : 0, // players walk up
    action: "Idle",
    spawning: arrivalTime(card, side, y, x),
    arriveTime: arrivalTime(card, side, y, x),
    // Where it surfaces, and where it set off from. Only a digger has these.
    digTo: digs ? { x, y } : undefined,
    digFrom: digs ? start : undefined,
  };
  match.units.push(u);
  match.note("unit.spawn", "discrete", side, {
    id: u.id, card: card.id, x: u.x, y: u.y, lane: u.lane, arrive: u.arriveTime,
  });
  match.events.push({ type: "spawn", unit: u });
  return u;
}
