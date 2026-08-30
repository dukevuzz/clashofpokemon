/**
 * Shiny rolls on a pulled card.
 *
 * `core/` may not import `ui/` -- see DESIGN-ADAPTATION.md: "Nothing in
 * core/ imports Phaser, touches the DOM, or draws anything" -- so packs.ts
 * reads `data/portraits.json` directly for its own "could this be shiny"
 * check rather than calling `ui/portraits.hasShiny`. The JSON is mocked
 * here for the same reason `portraits-shiny.test.ts` mocks it: the export
 * tool that puts real shiny frames on the sheet is being built concurrently
 * and is not in yet.
 */

import { describe, it, expect, vi } from "vitest";
import * as cards from "../src/core/cards";

// Only pikachu has a shiny frame, for the purpose of this file -- an
// arbitrary but fixed line so the tests can assert exactly which side of it
// a card falls on.
vi.mock("../src/data/portraits.json", () => ({
  default: { size: 40, cols: 16, frames: {}, shiny: { pikachu: 0 } },
}));

const packs = await import("../src/core/packs");

/** Same deterministic generator the rest of the pack tests use. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("shiny rolls, per card", () => {
  it("never rolls shiny for a species with no shiny art", () => {
    // rng() => 0 would take every roll if the chance check ran; the point is
    // that it is never reached for a card `hasShiny` says no to.
    const squirtle = cards.byId("squirtle")!;
    const rolled = packs.withShinyRoll(squirtle, () => 0);
    expect(rolled.shiny).toBeUndefined();
    expect(rolled).toEqual(squirtle);
  });

  it("can roll shiny for a species that has shiny art", () => {
    const pikachu = cards.byId("pikachu")!;
    const rolled = packs.withShinyRoll(pikachu, () => 0);
    expect(rolled.shiny).toBe(true);
  });

  it("misses at the chance boundary and above it", () => {
    const pikachu = cards.byId("pikachu")!;
    expect(packs.withShinyRoll(pikachu, () => packs.SHINY_CHANCE).shiny).toBeUndefined();
    expect(packs.withShinyRoll(pikachu, () => 0.999).shiny).toBeUndefined();
  });

  it("is 5%", () => {
    expect(packs.SHINY_CHANCE).toBe(0.05);
  });

  it("does not mutate the card it was given", () => {
    const pikachu = cards.byId("pikachu")!;
    packs.withShinyRoll(pikachu, () => 0);
    expect(pikachu.shiny).toBeUndefined();
  });
});

describe("shiny rolls, across a whole pack", () => {
  it("is the same for the same seed, card for card", () => {
    const a = packs.open(mulberry(11)).map((c) => c.shiny ?? false);
    const b = packs.open(mulberry(11)).map((c) => c.shiny ?? false);
    expect(b).toEqual(a);
  });

  it("only ever flags the species shiny art exists for", () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const c of packs.open(mulberry(seed))) {
        if (c.shiny) expect(c.sheet, `seed ${seed}`).toBe("pikachu");
      }
    }
  });

  it("turns up sometimes, across enough packs, for the species that can be shiny", () => {
    // Loose bounds: this is luck, not a rate to pin exactly, and pikachu is
    // only in a pack when it happens to be drawn at all.
    let shinies = 0;
    for (let seed = 1; seed <= 20000; seed++) {
      if (packs.open(mulberry(seed)).some((c) => c.shiny)) shinies++;
    }
    expect(shinies).toBeGreaterThan(0);
  });
});

describe("settling a pack that contains a shiny", () => {
  it("counts a shiny as new even though the plain card is already owned", () => {
    const shinyPikachu = { ...cards.byId("pikachu")!, shiny: true };
    const owned = packs.ownershipKeys(new Set(["pikachu"]), new Set());
    const got = packs.settle([shinyPikachu], owned);
    expect(got.fresh.map((c) => c.id)).toEqual(["pikachu"]);
    expect(got.duplicates).toHaveLength(0);
  });

  it("counts a shiny as a duplicate once the shiny itself is owned", () => {
    const shinyPikachu = { ...cards.byId("pikachu")!, shiny: true };
    const owned = packs.ownershipKeys(new Set(["pikachu"]), new Set(["pikachu"]));
    const got = packs.settle([shinyPikachu], owned);
    expect(got.fresh).toHaveLength(0);
    expect(got.duplicates.map((c) => c.id)).toEqual(["pikachu"]);
  });

  it("does not let owning the shiny make the plain card seem owned", () => {
    const plainPikachu = cards.byId("pikachu")!;
    const owned = packs.ownershipKeys(new Set(), new Set(["pikachu"]));
    const got = packs.settle([plainPikachu], owned);
    expect(got.fresh.map((c) => c.id)).toEqual(["pikachu"]);
  });
});
