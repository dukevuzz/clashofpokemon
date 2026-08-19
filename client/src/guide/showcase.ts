/**
 * A card doing its job, as a timeline.
 *
 * The card face gives numbers and the matchups give counters, and neither
 * answers what a player actually wants to know first: what does this thing
 * look like when I play it. Clash Royale answers that by showing the card in
 * the lane rather than in a portrait, which is a better idea than a bigger
 * picture of the same art.
 *
 * The loop is walk, stop at range, attack. That order is not decoration -- it
 * is the two stats hardest to read off a number. `Range 180` means nothing
 * until you watch Alakazam stop most of a lane short of the tower; `0.94/sec`
 * means nothing until you watch Lugia swing.
 *
 * This file is the timeline and nothing else: no canvas, no images, no DOM. It
 * says which animation is playing and where the creature is at time t, and the
 * component draws whatever it is told. That makes the interesting part -- does
 * a long-ranged card really stop further out -- testable without a browser.
 */

import type { Card } from "../core/cards";
import { SHEETS } from "../data/sheets";
import { attackAnim, castAnim, WALK, firstAnim } from "../data/actions";

/*
 * Facing the viewer, walking down the lane at a tower below.
 *
 * The first version walked up the lane, which is what your own cards do -- and
 * shows you the back of the creature for the whole loop. Machop from behind is
 * an unreadable white blob, and a card showcase whose subject is unidentifiable
 * has failed at the one job it has.
 *
 * Turning it round costs nothing in honesty: this is exactly what the card
 * looks like coming at *you*, which is the half of every match a player spends
 * trying to recognise something quickly.
 */
export const DOWN = 0;

/** Facing back up the lane, which is where the defender is looking. */
export const UP = 4;

/*
 * Who it is walking at.
 *
 * A tower first, which was wrong for the half of the roster that arrives by
 * air: Snorlax falling on an empty patch of grass beside a building does not
 * show what a drop is *for*, and a drop's whole point is what it lands on.
 * A creature standing there makes the impact legible -- and makes range read
 * as range rather than as a gap before a wall.
 *
 * Pikachu unless the card being shown is Pikachu, in which case something
 * else: a card sparring with itself teaches nothing about matchups and looks
 * like a rendering bug.
 */
export const SPARRING = "pikachu";
export const SPARRING_ALT = "machop";

export function sparringFor(card: Card): string {
  return card.sheet === SPARRING ? SPARRING_ALT : SPARRING;
}

/*
 * A real slice of the board, at board scale.
 *
 * One stage unit is one board unit, so reach is the card's range and nothing
 * has to be translated. That is the whole reason for the size: a small stage
 * made a legendary fill the frame and left no room for a sniper to stand back
 * in -- Xerneas covered the strip and its defender at once, and 180 range and
 * 15 range looked identical.
 *
 * 176 x 248 out of a 384 x 672 board is a little under half a lane, which is
 * about as much as a card panel can show while a 40-pixel creature still reads
 * as a creature. Sprites are drawn at their own size, never scaled, because a
 * scaled pixel is a smeared one.
 */
export const STAGE = { width: 176, height: 248 } as const;

/*
 * The tower is at the bottom and the creature comes down from the top, so
 * `y` grows as it advances. Feet stop short of the tower by its reach.
 */
const FOE_STANDS = STAGE.height - 46;
const START_Y = -30;
// Close enough to read as contact: a melee card should look like it is hitting
// the thing, not standing politely a body-length away.
// Touching distance, in board units: a melee card stops about a tile away.
const CONTACT_Y = FOE_STANDS - 26;

/*
 * The roster's speed range, and the seconds it maps to.
 *
 * Read off the cards rather than guessed: `tools/selfcheck.ts` prints these,
 * and if a future card is slower than Snorlax the clamp keeps it watchable
 * instead of stranding it off screen.
 */
const SLOWEST = 10;
const FASTEST = 34;
const SLOW_SECONDS = 3.4;
const FAST_SECONDS = 1.2;

export interface Beat {
  /** Which animation row to play: an anim name from the sheet. */
  anim: string;
  /** Position of the creature's feet, in stage units. */
  y: number;
  /** How far through this animation, 0..1, for picking a frame. */
  through: number;
  /** True on the frames where the tower should flinch. */
  hitting: boolean;
  /**
   * A projectile in flight, 0 at the creature and 1 at the tower.
   *
   * Undefined for melee, and for the part of a ranged swing before release.
   * Without it a ranged card plays its Shoot pose at empty grass -- reported
   * as "Dreepy shoot but no shoot sprite", which was not a missing animation
   * but a missing bullet.
   */
  shot?: number;
  /** True while the skill pose is playing, so the strip can name it. */
  casting?: boolean;
  /**
   * How this card is arriving, and how far through, 0..1.
   *
   * Snorlax falls, Voltorb is thrown and Diglett tunnels, and none of them
   * walks up a lane -- showing them strolling in would teach the one thing
   * about them that is not true. Undefined for everything that does walk.
   */
  arriving?: { kind: "drop" | "throw" | "tunnel"; frac: number };
}

export interface Plan {
  /** Total loop length in seconds. */
  length: number;
  /** Where this card stops, so the caller can draw its reach honestly. */
  stopY: number;
  walkFor: number;
  attackFor: number;
  attacks: number;
  /** The animation this card attacks with, which is rarely called "Attack". */
  attackAnim: string;
  /** Present only if the sheet has nothing to walk with. */
  walkAnim: string;
  /** Whether this card throws something, which decides if a shot is drawn. */
  ranged: boolean;
  /** The skill pose, shown last: it is usually why the card is worth playing. */
  castAnim: string;
  castFor: number;
  /** Set when the card arrives by air or underground rather than on foot. */
  delivery?: "drop" | "throw" | "tunnel";
}

/**
 * The attack row for a card, chosen exactly as the game chooses it.
 *
 * Through the shared resolver, so the stored pose wins: Machop kicks, Voltorb
 * shocks, and a sheet whose declared attack is "Kick" must not show "Attack"
 * here just because a priority list happens to start there.
 */
export function attackAnimFor(card: Card): string {
  return attackAnim(card.sheet, card.range > 30 ? "ranged" : "melee");
}

export function walkAnimFor(card: Card): string {
  return firstAnim(card.sheet, WALK) ?? "Idle";
}

/** How long one cycle of an animation takes, from the sheet's own timings. */
export function animSeconds(sheet: string, anim: string, dir = DOWN): number {
  const rows = SHEETS[sheet]?.anims?.[anim] as
    | Record<string, { durations: number[] }>
    | undefined;
  const row = rows?.[String(dir)] ?? rows?.["0"];
  if (!row) return 0.6;
  const total = row.durations.reduce((a, b) => a + b, 0);
  return total > 0 ? total : 0.6;
}

/**
 * The whole loop for one card.
 *
 * Walk time is derived from the distance rather than fixed, so a runner
 * crosses the strip quickly and Snorlax lumbers -- speed is the third stat
 * that a number does not convey.
 */
export function planFor(card: Card): Plan {
  const attackAnim = attackAnimFor(card);
  const walkAnim = walkAnimFor(card);

  /*
   * Reach is the range, unscaled, because the strip is at board scale.
   *
   * Clamped only so a sniper still fits on the strip: 180 units of range is
   * most of what is drawn, and a card standing off the top edge shows nothing
   * at all -- which is how every legendary rendered as an empty green square.
   */
  const reach = Math.min(STAGE.height - 96, card.range);
  const stopY = Math.min(CONTACT_Y, FOE_STANDS - reach);

  /*
   * How long the walk takes to watch, not how long it takes in a match.
   *
   * Scaling the board speed directly gave Machop a fifteen-second entrance --
   * correct arithmetic and a useless animation, since it spends thirteen of
   * those seconds off the top of a strip a hundred and fifty units wide. The
   * relative ordering is what carries the information, so the roster's speed
   * range is mapped onto a couple of seconds: the fastest card still arrives
   * in a third of the time the slowest one takes.
   */
  const t = Math.min(1, Math.max(0, (card.speed - SLOWEST) / (FASTEST - SLOWEST)));
  // Speed zero is a building. It does not walk in, so it does not walk here:
  // marching a stationary card up a lane would be inventing behaviour.
  const walkFor = card.speed <= 0
    ? 0
    : SLOW_SECONDS + (FAST_SECONDS - SLOW_SECONDS) * t;

  /*
   * Cards that do not walk in.
   *
   * Snorlax drops, Voltorb is thrown and Diglett tunnels. Their arrival is the
   * whole point of playing them -- a thrown card ignores the halfway line, a
   * dropped one damages whatever it lands on -- and a strip that walks them up
   * a lane teaches the one thing about them that is false.
   *
   * Timed from the card's own deployDelay, so Snorlax's two and a bit seconds
   * of shadow really is longer than Diglett's dig.
   */
  const delivery = card.delivery === "drop" || card.delivery === "throw"
      || card.delivery === "tunnel"
    ? card.delivery
    : undefined;
  const arriveFor = delivery ? Math.min(2.4, Math.max(0.9, card.deployDelay)) : 0;

  // Two swings, so the rate is legible as a rhythm rather than a single hit.
  const swing = Math.max(animSeconds(card.sheet, attackAnim), 1 / Math.max(card.attackRate, 0.2));
  const attacks = 2;
  const attackFor = swing * attacks;

  // The skill, once, after the ordinary attacks. Long enough to see and not
  // so long that the loop stops being a loop.
  const cast = castAnim(card.sheet);
  // Compared against the local, which is already this card's attack row.
  const castFor = cast === attackAnim
    ? 0                       // no separate pose: showing it twice teaches nothing
    : Math.max(0.7, animSeconds(card.sheet, cast));

  return {
    // A beat of stillness before it loops.
    length: (delivery ? arriveFor : walkFor) + attackFor + castFor + 0.5,
    stopY,
    walkFor: delivery ? arriveFor : walkFor,
    attackFor, attacks, attackAnim, walkAnim,
    ranged: card.range > 30,
    castAnim: cast, castFor,
    delivery,
  };
}

/** What is on screen at time t, in seconds, within the loop. */
export function beatAt(card: Card, plan: Plan, t: number): Beat {
  const time = ((t % plan.length) + plan.length) % plan.length;

  if (plan.walkFor > 0 && time < plan.walkFor) {
    const done = time / plan.walkFor;

    // Arriving rather than walking: it is already where it will be, and what
    // changes is how much of it has got there.
    if (plan.delivery) {
      return {
        anim: plan.walkAnim,
        y: plan.stopY,
        through: 0,
        /*
         * A drop lands on things.
         *
         * `dropImpact` is 36 units of radius at 1.6x damage, applied the
         * moment it touches down -- the opponent gets the whole deploy delay
         * to walk out of the shadow, which is what stops it being a free hit.
         * Showing the fall without the landing showed the half that costs
         * nothing and hid the half that does the damage.
         *
         * Only a drop: a thrown card arrives and a tunneller surfaces, and
         * neither hits anything on the way in.
         */
        hitting: plan.delivery === "drop" && done > 0.93,
        arriving: { kind: plan.delivery, frac: done },
      };
    }

    const cycle = animSeconds(card.sheet, plan.walkAnim);
    return {
      anim: plan.walkAnim,
      y: START_Y + (plan.stopY - START_Y) * done,
      through: (time % cycle) / cycle,
      hitting: false,
    };
  }

  const since = time - plan.walkFor;
  if (since < plan.attackFor) {
    const swing = plan.attackFor / plan.attacks;
    const through = (since % swing) / swing;
    /*
     * Release partway through the wind-up, and land at the end of it.
     *
     * A ranged card's pose is a throw, and a throw with nothing leaving the
     * hand reads as a miss. The flight is short because the gap it crosses is
     * short -- the point is that something crossed it, not a ballistic arc.
     */
    const RELEASE = 0.42;
    const shot = plan.ranged && through >= RELEASE
      ? Math.min(1, (through - RELEASE) / (1 - RELEASE))
      : undefined;

    return {
      anim: plan.attackAnim,
      y: plan.stopY,
      // The tower flinches when the shot arrives, or -- for melee -- partway
      // through the swing, so the hit lands with the animation rather than
      // before it.
      through,
      hitting: plan.ranged
        ? shot !== undefined && shot > 0.82
        : through > 0.45 && through < 0.62,
      shot,
    };
  }

  const afterAttacks = time - plan.walkFor - plan.attackFor;
  if (plan.castFor > 0 && afterAttacks < plan.castFor) {
    return {
      anim: plan.castAnim,
      y: plan.stopY,
      through: afterAttacks / plan.castFor,
      hitting: false,
      casting: true,
    };
  }

  return { anim: plan.walkAnim, y: plan.stopY, through: 0, hitting: false };
}
