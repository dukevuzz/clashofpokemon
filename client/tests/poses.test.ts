/**
 * Every creature has a way to show what it is doing.
 *
 * Two defects lived here for a long time, both invisible because the answer was
 * derived at draw time instead of recorded:
 *
 *   - Three creatures had no attack motion and stood in an idle pose while
 *     dealing damage. That was written down for weeks as "no attack animation",
 *     with a note that better art might exist. The art was always there:
 *     the importer asked for eight fixed row names, and Togepi attacks with
 *     `Appeal`, Jolteon with `Shock`, Blastoise with `Ricochet`.
 *   - Every creature cast its skill using its ordinary swing, because the cast
 *     pose PAC records separately was never imported at all.
 *
 * These assert the data, not the drawing: if a sheet has no pose recorded, no
 * amount of renderer cleverness will invent one.
 */

import { describe, it, expect } from "vitest";
import { SHEETS } from "../src/data/sheets";
import { ALL } from "../src/core/cards";
import * as evolution from "../src/core/evolution";

/** Base cards and everything they grow into -- what a match can actually show. */
const playable = (() => {
  const out = new Set<string>();
  for (const c of ALL) for (const f of evolution.chainOf(c.id) ?? [c.id]) out.add(f);
  return [...out];
})();

describe("every playable form can show an attack", () => {
  it.each(playable)("%s has a pose for the way it fights", (form) => {
    const sheet = SHEETS[form];
    expect(sheet).toBeDefined();
    const card = ALL.find((c) => (evolution.chainOf(c.id) ?? [c.id]).includes(form))!;
    const pose = card.range > 30 ? sheet.shoot : sheet.attack;
    expect(pose).toBeTruthy();
  });

  it("the pose names a row the sheet actually carries", () => {
    for (const form of playable) {
      const sheet = SHEETS[form];
      for (const pose of [sheet.attack, sheet.shoot, sheet.ability]) {
        if (pose) expect(Object.keys(sheet.anims)).toContain(pose);
      }
    }
  });

  it("the three that were broken are fixed, with PAC's own animations", () => {
    // Not Hop. A jump is not an attack, and borrowing one was tried and undone.
    expect(SHEETS.togepi.attack).toBe("Appeal");
    expect(SHEETS.togetic.attack).toBe("Hover");
    expect(SHEETS.jolteon.attack).toBe("Shock");
  });
});

describe("casting looks different from swinging", () => {
  it("most forms carry a distinct cast pose", () => {
    const withCast = playable.filter((f) => SHEETS[f]?.ability);
    // It is not universal -- a few sheets genuinely use one row for both -- but
    // it must be the common case, or the field is not doing anything.
    expect(withCast.length).toBeGreaterThan(playable.length * 0.5);
  });

  it("a cast pose differs from the attack pose more often than not", () => {
    const both = playable
      .map((f) => SHEETS[f])
      .filter((s) => s?.ability && s?.attack);
    const different = both.filter((s) => s.ability !== s.attack);
    expect(different.length).toBeGreaterThan(both.length * 0.5);
  });

  it("falls back rather than vanishing when a sheet has no cast row", () => {
    // resolve() uses ability ?? attack ?? shoot, so a missing cast pose shows
    // the swing -- which is exactly what every creature did before this field.
    for (const form of playable) {
      const s = SHEETS[form];
      const fallback = s.ability ?? s.attack ?? s.shoot;
      expect(fallback).toBeTruthy();
    }
  });
});
