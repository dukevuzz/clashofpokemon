/**
 * The lane animation, as a timeline.
 *
 * The point of the strip is that it is honest: a long-ranged card must visibly
 * stop further from the tower than a melee one, a fast card must cross sooner
 * than a slow one, and a creature that kicks must play its kick. All three are
 * checkable without a canvas, which is why the timeline is a separate file.
 */

import { describe, expect, it } from "vitest";
import * as cards from "../src/core/cards";
import { SHEETS } from "../src/data/sheets";
import { attackAnim } from "../src/data/actions";
import { planFor, beatAt, attackAnimFor, walkAnimFor, STAGE } from "../src/guide/showcase";
import { castAnim } from "../src/data/actions";
import { readFileSync } from "node:fs";

/*
 * Picked from the data rather than named.
 *
 * A first draft hardcoded "alakazam" and "machop", and alakazam is not in the
 * playable pool -- the test failed on an undefined card rather than on the
 * behaviour it was checking. Asking the roster for its own extremes cannot go
 * stale when the card list changes.
 */
const sorted = <T,>(list: T[], by: (t: T) => number) => [...list].sort((a, b) => by(a) - by(b));
const shortest = sorted(cards.ALL, (c) => c.range)[0];
const longest = sorted(cards.ALL, (c) => c.range)[cards.ALL.length - 1];
const slowest = sorted(cards.ALL, (c) => c.speed)[0];
const fastest = sorted(cards.ALL, (c) => c.speed)[cards.ALL.length - 1];

describe("the lane showcase", () => {
  it("stops a ranged card further out than a melee one", () => {
    // The whole reason range is worth animating: 180 means nothing as a number.
    // The tower is at the bottom, so a longer reach stops at a *smaller* y.
    expect(longest.range).toBeGreaterThan(shortest.range);
    expect(planFor(longest).stopY).toBeLessThan(planFor(shortest).stopY);
  });

  it("takes longer to cross with a slower card", () => {
    // Among cards that move at all: a building's walk is zero by design.
    const movers = cards.ALL.filter((c) => c.speed > 0);
    const slow = sorted(movers, (c) => c.speed)[0];
    const fast = sorted(movers, (c) => c.speed)[movers.length - 1];
    expect(fast.speed).toBeGreaterThan(slow.speed);
    expect(planFor(fast).walkFor).toBeLessThan(planFor(slow).walkFor);
  });

  it("does not march a building up the lane", () => {
    // Speed zero means it was placed where it stands. Walking it in would be
    // inventing behaviour the game does not have.
    for (const c of cards.ALL.filter((x) => x.speed <= 0)) {
      const plan = planFor(c);
      expect(plan.walkFor, c.name).toBe(0);
      expect(beatAt(c, plan, 0).anim, c.name).toBe(plan.attackAnim);
    }
  });

  it("keeps every loop short enough to watch", () => {
    // A first draft scaled board speed directly and gave Machop a fifteen
    // second entrance, thirteen of them off the top of the strip.
    for (const c of cards.ALL) {
      expect(planFor(c).length, `${c.name} loop`).toBeLessThan(9);
    }
  });

  it("walks first, then attacks, then loops", () => {
    const c = shortest;
    const plan = planFor(c);

    const early = beatAt(c, plan, 0.05);
    expect(early.anim).toBe(plan.walkAnim);
    // It starts above the strip and comes down, so early y is the smaller one.
    expect(early.y).toBeLessThan(plan.stopY);

    const fighting = beatAt(c, plan, plan.walkFor + 0.05);
    expect(fighting.anim).toBe(plan.attackAnim);
    expect(fighting.y).toBeCloseTo(plan.stopY, 5);

    // And the loop is a loop: t and t + length are the same moment.
    const a = beatAt(c, plan, 0.3);
    const b = beatAt(c, plan, 0.3 + plan.length);
    expect(b).toEqual(a);
  });

  it("lands the flinch during a swing, not before it", () => {
    const c = shortest;
    const plan = planFor(c);
    expect(beatAt(c, plan, plan.walkFor + 0.001).hitting).toBe(false);
    const swing = plan.attackFor / plan.attacks;
    expect(beatAt(c, plan, plan.walkFor + swing * 0.5).hitting).toBe(true);
  });

  it("never leaves the creature off the strip", () => {
    for (const c of cards.ALL) {
      const plan = planFor(c);
      for (let t = 0; t < plan.length; t += plan.length / 24) {
        const b = beatAt(c, plan, t);
        expect(Number.isFinite(b.y), `${c.name} has a position`).toBe(true);
        // It may start above the strip -- that is what walking in looks like --
        // but it must never wander further than a sprite's height away, and
        // never below the ground it is standing on.
        expect(b.y).toBeLessThanOrEqual(STAGE.height);
        expect(b.y).toBeGreaterThanOrEqual(-40);
      }
    }
  });

  it("picks an animation the sheet actually has, for every card", () => {
    // Machop kicks, Voltorb shocks, a dozen sheets have only Shoot. Naming a
    // row that does not exist draws nothing at all.
    for (const c of cards.ALL) {
      const sheet = SHEETS[c.sheet];
      if (!sheet) continue;
      expect(sheet.anims[attackAnimFor(c)], `${c.name} attack row`).toBeTruthy();
      expect(sheet.anims[walkAnimFor(c)], `${c.name} walk row`).toBeTruthy();
    }
  });

  it("uses the same attack row the game uses", () => {
    // One resolver, two readers. If these ever disagree the guide is showing a
    // creature doing something it never does in a match.
    for (const c of cards.ALL) {
      const kind = c.range > 30 ? "ranged" : "melee";
      expect(attackAnimFor(c), c.name).toBe(attackAnim(c.sheet, kind));
    }
  });

  it("sends something across the gap when a card attacks at range", () => {
    /*
     * Reported as "Dreepy shoot but no shoot sprite". The animation was right
     * all along -- Dreepy has a Shoot row and plays it -- and nothing left its
     * hands, so a throw at a tower two body-lengths away read as a miss.
     */
    const ranged = cards.ALL.filter((c) => c.range > 30);
    expect(ranged.length).toBeGreaterThan(0);

    for (const c of ranged.slice(0, 12)) {
      const plan = planFor(c);
      const shots: number[] = [];
      for (let t = plan.walkFor; t < plan.walkFor + plan.attackFor; t += 0.02) {
        const shot = beatAt(c, plan, t).shot;
        if (shot !== undefined) shots.push(shot);
      }
      expect(shots.length, `${c.name} fires`).toBeGreaterThan(0);
      // It travels the whole way rather than appearing at the far end.
      expect(Math.min(...shots)).toBeLessThan(0.2);
      expect(Math.max(...shots)).toBeGreaterThan(0.9);
    }
  });

  it("does not draw a shot for a card that swings", () => {
    for (const c of cards.ALL.filter((x) => x.range <= 30).slice(0, 12)) {
      const plan = planFor(c);
      for (let t = 0; t < plan.length; t += plan.length / 30) {
        expect(beatAt(c, plan, t).shot, c.name).toBeUndefined();
      }
    }
  });

  it("shows the skill, and only when it differs from the attack", () => {
    // The skill is usually why a card is worth playing; a strip that never
    // shows it is showing half the card. Playing the same pose twice under
    // two names teaches nothing, so those are skipped instead.
    let shown = 0;
    for (const c of cards.ALL) {
      const plan = planFor(c);
      const skill = castAnim(c.sheet);
      if (skill === plan.attackAnim) {
        expect(plan.castFor, `${c.name} has no separate skill pose`).toBe(0);
        continue;
      }
      expect(plan.castFor, `${c.name} shows ${skill}`).toBeGreaterThan(0);
      const during = beatAt(c, plan, plan.walkFor + plan.attackFor + plan.castFor / 2);
      expect(during.anim, c.name).toBe(skill);
      expect(during.casting).toBe(true);
      shown++;
    }
    expect(shown, "some cards have a distinct skill pose").toBeGreaterThan(20);
  });

  it("draws every card somewhere on the strip", () => {
    /*
     * The bug this exists for: a PMD cell is centred on the body, not resting
     * on it, and anchoring by the cell bottom put every 136-tall legendary
     * fifty pixels above the strip. Zapdos rendered as an empty green square
     * and nothing failed.
     *
     * Checked against the real atlas rather than against the cell size, since
     * the cell is mostly transparent margin and the crop is what gets drawn.
     */
    type Frame = [number, number, number, number, number, number];
    const atlas = JSON.parse(
      readFileSync("public/atlas/index.json", "utf8"),
    ) as Record<string, { cell: [number, number]; f: Record<string, Frame> }>;

    const offenders: string[] = [];
    for (const c of cards.ALL) {
      const entry = atlas[c.sheet];
      const sheet = SHEETS[c.sheet];
      if (!entry || !sheet) continue;
      const plan = planFor(c);
      const key = Object.keys(entry.f).find((k) => k.startsWith(`${plan.attackAnim}-0-`))
        ?? Object.keys(entry.f)[0];
      const [, , , h, , offY] = entry.f[key];
      const top = plan.stopY - entry.cell[1] / 2 + sheet.feetOffset + offY;
      if (top < 0 || top + h > STAGE.height) offenders.push(`${c.name} ${top.toFixed(0)}..${(top + h).toFixed(0)}`);
    }
    expect(offenders, `outside a ${STAGE.width}x${STAGE.height} strip`).toEqual([]);
  });

  it("delivers the cards that do not walk in", () => {
    // Snorlax falls, Voltorb is thrown, Diglett tunnels. Walking them up a
    // lane would teach the one thing about them that is false.
    const delivered = cards.ALL.filter((c) => c.delivery);
    expect(delivered.length).toBeGreaterThan(0);

    for (const c of delivered) {
      const plan = planFor(c);
      const beat = beatAt(c, plan, plan.walkFor / 2);
      expect(beat.arriving?.kind, c.name).toBe(c.delivery);
      // It is already where it lands; only its arrival is in progress.
      expect(beat.y).toBeCloseTo(plan.stopY, 5);
      expect(beat.arriving!.frac).toBeGreaterThan(0);
      expect(beat.arriving!.frac).toBeLessThan(1);
    }
  });

  it("lands a drop on whatever is under it", () => {
    // dropImpact is 36 units at 1.6x, applied the moment it touches down.
    // Showing the fall without the landing shows the half that costs nothing.
    for (const c of cards.ALL.filter((x) => x.delivery === "drop")) {
      const plan = planFor(c);
      const landing = beatAt(c, plan, plan.walkFor * 0.985);
      expect(landing.hitting, `${c.name} lands on something`).toBe(true);
      // And not before: the shadow is a warning, not a hit.
      expect(beatAt(c, plan, plan.walkFor * 0.5).hitting, c.name).toBe(false);
    }
  });

  it("does not hit anything on the way in when thrown or tunnelling", () => {
    for (const c of cards.ALL.filter((x) => x.delivery === "throw" || x.delivery === "tunnel")) {
      const plan = planFor(c);
      for (let t = 0; t < plan.walkFor; t += plan.walkFor / 12) {
        expect(beatAt(c, plan, t).hitting, c.name).toBe(false);
      }
    }
  });

  it("walks in everything that walks", () => {
    for (const c of cards.ALL.filter((x) => !x.delivery && x.speed > 0).slice(0, 20)) {
      const plan = planFor(c);
      expect(beatAt(c, plan, plan.walkFor / 2).arriving, c.name).toBeUndefined();
    }
  });

  it("honours the pose the sheet declares, not the first name on a list", () => {
    /*
     * The sheets record their own attack and shoot rows -- decided once by
     * tools/resolve-poses.py -- and the priority lists are only a fallback.
     * A first draft read the list first, which would have shown "Attack" for
     * a creature whose declared pose is "Kick" or "Shock".
     */
    let checked = 0;
    for (const c of cards.ALL) {
      const sheet = SHEETS[c.sheet];
      const stored = c.range > 30 ? sheet?.shoot : sheet?.attack;
      if (!stored || !sheet?.anims[stored]) continue;
      expect(attackAnimFor(c), `${c.name} declares ${stored}`).toBe(stored);
      checked++;
    }
    // If nothing had a stored pose this test would pass by doing nothing.
    expect(checked).toBeGreaterThan(cards.ALL.length / 2);
  });
});
