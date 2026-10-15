/**
 * The arena's roster is not the lane's.
 *
 * The lane deck is 151 cards chosen for an elixir economy. The arena charges
 * nothing and has no evolution step, so a lane deck walks in as whatever it
 * is -- and a stage-1 loses to a stage-3 about 98% of the time. Rather than
 * resolve each card to a final form at the door, the arena gets its own
 * roster: every creature we can draw, picked directly. Charizard is an entry,
 * not something Charmander has to become.
 */

import { describe, expect, it } from "vitest";
import { ARENA_ALL, arenaById } from "../src/core/arenaRoster";
import { MEGA } from "../src/core/mega";
import { ALL } from "../src/core/cards";
import { SHEETS } from "../src/data/sheets";

describe("the arena roster", () => {
  it("is every creature we can draw", () => {
    // Not CARD_TABLE: that is what the *lane* roster can reach, which leaves
    // out sheets no lane card evolves into.
    expect(ARENA_ALL.length).toBeGreaterThan(ALL.length);
    expect(ARENA_ALL.length).toBe(302);
  });

  it("holds no Mega forms", () => {
    // A Mega is a button paid for mid-fight, not a card you slot. Checked
    // against MEGA's values rather than a "mega" prefix, because primalgroudon
    // and primalkyogre are Megas that do not carry the prefix.
    const megaForms = new Set(Object.values(MEGA));
    for (const card of ARENA_ALL) {
      expect(megaForms.has(card.id), `${card.id} is a Mega form`).toBe(false);
    }
  });

  it("includes the forms the lane roster cannot reach", () => {
    // These have sheets but nothing in the lane roster evolves into them, so
    // they are absent from CARD_TABLE and would be missing from a roster
    // derived from it.
    for (const id of ["azurill", "munchlax", "ponyta", "rapidash"]) {
      expect(arenaById(id), `${id} is missing`).toBeTruthy();
    }
  });

  it("contains every lane card, so no deck becomes unbuildable", () => {
    for (const card of ALL) {
      expect(arenaById(card.id), `${card.id} dropped out`).toBeTruthy();
    }
  });

  it("only holds creatures that have a sheet", () => {
    for (const card of ARENA_ALL) {
      expect(SHEETS[card.id], `${card.id} has no sheet`).toBeTruthy();
    }
  });

  it("has no duplicates and a stable order", () => {
    const ids = ARENA_ALL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Sorted by id rather than by the order sheets.json happens to list them,
    // so adding a sheet does not reshuffle the picker.
    expect(ids).toEqual([...ids].sort());
  });

  it("looks up by id", () => {
    expect(arenaById("charizard")?.id).toBe("charizard");
    expect(arenaById("nosuchcreature")).toBeUndefined();
  });
});
