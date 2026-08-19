/**
 * What the guide's filters and prose claim, checked against the rules.
 *
 * Both bugs here were the same shape: a sentence that sounded right and a
 * rule that said otherwise. Prose cannot be tested, but the facts underneath
 * it can, and these are the facts the prose is written from.
 */

import { describe, expect, it } from "vitest";
import * as cards from "../src/core/cards";
import { config } from "../src/core/config";

describe("which cards ignore the halfway line", () => {
  it("is thrown and tunnelling, and not dropped", () => {
    // "arrives anywhere" used to mean "has any delivery at all", which put
    // Snorlax in a list of cards that can be placed on the enemy's side. It
    // cannot: it falls from the sky onto your own half.
    expect(cards.arrivesAnywhere("throw")).toBe(true);
    expect(cards.arrivesAnywhere("tunnel")).toBe(true);
    expect(cards.arrivesAnywhere("drop")).toBe(false);
    expect(cards.arrivesAnywhere(undefined)).toBe(false);
  });

  it("keeps Snorlax on your own half", () => {
    const snorlax = cards.byId("snorlax")!;
    expect(snorlax.delivery).toBe("drop");
    expect(cards.arrivesAnywhere(snorlax.delivery)).toBe(false);
  });

  it("lets Voltorb and Diglett cross it", () => {
    expect(cards.arrivesAnywhere(cards.byId("voltorb")!.delivery)).toBe(true);
    expect(cards.arrivesAnywhere(cards.byId("diglett")!.delivery)).toBe(true);
  });

  it("counts more cards as delivered than as unrestricted", () => {
    // The two traits are separate because they select different cards. If
    // they ever returned the same set, one of them is redundant.
    const delivered = cards.ALL.filter((c) => Boolean(c.delivery));
    const anywhere = cards.ALL.filter((c) => cards.arrivesAnywhere(c.delivery));
    expect(delivered.length).toBeGreaterThan(anywhere.length);
    expect(anywhere.length).toBeGreaterThan(0);
  });
});

describe("the type filter", () => {
  it("has enough multi-type cards for 'all of' to be the useful reading", () => {
    // The filter combined types with "any of" on the reasoning that a dual
    // type is rare. It is the common case, which is why that was wrong.
    const multi = cards.ALL.filter((c) => c.types.length > 1);
    expect(multi.length).toBeGreaterThan(cards.ALL.length / 2);
  });

  it("has cards at each type count the filter offers", () => {
    for (const n of [1, 2, 3]) {
      const at = cards.ALL.filter((c) => c.types.length === n);
      expect(at.length, `${n}-type cards exist`).toBeGreaterThan(0);
    }
  });

  it("never exceeds three types, which is what the filter assumes", () => {
    const most = Math.max(...cards.ALL.map((c) => c.types.length));
    expect(most).toBe(3);
  });
});

describe("what a delivery costs the other side", () => {
  it("gives a dropped card a landing hit worth printing", () => {
    /*
     * Reported as "u miss the drop dmg": the animation showed Snorlax falling
     * and the stat table listed only its attack, so the most expensive thing
     * about playing it was invisible. Landing damage is 1.6x in a 36-unit
     * circle -- a tile and a half -- which for Snorlax is more than its swing.
     */
    const { radius, damage } = config.dropImpact;
    expect(damage).toBeGreaterThan(1);
    expect(radius).toBeGreaterThan(24);

    const snorlax = cards.byId("snorlax")!;
    expect(snorlax.delivery).toBe("drop");
    expect(Math.round(snorlax.damage * damage)).toBeGreaterThan(snorlax.damage);
  });

  it("only lands a hit for cards that fall", () => {
    // A thrown card arrives and a tunneller surfaces; neither hits anything
    // on the way in, so neither should claim a landing hit.
    for (const c of cards.ALL) {
      if (c.delivery === "drop") continue;
      expect(["throw", "tunnel", undefined]).toContain(c.delivery);
    }
  });

  it("has a deploy delay for everything that is delivered", () => {
    // The delay is what the opponent is given to answer it, and a delivery
    // with no delay would be a free hit rather than a telegraphed one.
    for (const c of cards.ALL.filter((x) => x.delivery)) {
      expect(c.deployDelay, `${c.name} is telegraphed`).toBeGreaterThan(0.5);
    }
  });
});
