/**
 * Shiny portraits against the real, unmocked `portraits.json`.
 *
 * The export tool that fills in `shiny` is being built by somebody else, on
 * their own clock, concurrently with this file. That means this suite
 * cannot assume the key is absent OR that it is complete -- either could be
 * true by the time this runs -- so every case here picks its species by
 * asking the real data what it actually contains, rather than assuming a
 * shape. `portraits-shiny.test.ts` and `portraits-shiny-rows.test.ts` pin
 * the exact contract with a mocked fixture; this file is the check against
 * whatever has actually shipped.
 */

import { describe, it, expect } from "vitest";
import * as portraits from "../src/ui/portraits";
import portraitsJson from "../src/data/portraits.json";

const DATA = portraitsJson as {
  frames: Record<string, number>;
  shiny?: Record<string, number>;
};
const ALL_SPECIES = Object.keys(DATA.frames);
// Guaranteed to exist whether or not the export tool has run at all: with no
// `shiny` key, every species qualifies; once it exists, the roster is large
// enough (341 species, at most a few hundred shiny) that some are always
// left over.
const WITHOUT_SHINY = ALL_SPECIES.find((s) => DATA.shiny?.[s] === undefined)!;

describe("shiny portraits, against whatever data has actually shipped", () => {
  it("never claims shiny art for a species that has none", () => {
    expect(portraits.hasShiny(WITHOUT_SHINY)).toBe(false);
    expect(portraits.hasShiny("not-a-real-species")).toBe(false);
  });

  it("falls back to the normal frame for a species with no shiny art", () => {
    // The whole point of the flag defaulting to false and falling back: a
    // call site that passes `shiny={card.shiny}` for a species with no
    // shiny art must render exactly as it did before the flag existed.
    const plain = portraits.styleFor(WITHOUT_SHINY, 40);
    const askedShiny = portraits.styleFor(WITHOUT_SHINY, 40, true);
    expect(askedShiny).toEqual(plain);
  });

  it("still returns nothing for a species with no portrait at all", () => {
    expect(portraits.styleFor("not-a-real-species", 40)).toEqual({});
    expect(portraits.styleFor("not-a-real-species", 40, true)).toEqual({});
  });

  it("uses a different frame for shiny once that species actually has one", () => {
    const withShiny = ALL_SPECIES.find((s) => DATA.shiny?.[s] !== undefined);
    if (!withShiny) return; // Nothing exported yet; nothing to check here.
    const plain = portraits.styleFor(withShiny, 40);
    const shiny = portraits.styleFor(withShiny, 40, true);
    expect(portraits.hasShiny(withShiny)).toBe(true);
    expect(shiny.backgroundPosition).not.toBe(plain.backgroundPosition);
  });

  it("preload still registers a sheet (a taller one will not need a code change)", () => {
    let calledWith: unknown[] = [];
    const loader = {
      spritesheet: (...args: unknown[]) => { calledWith = args; },
    } as unknown as Parameters<typeof portraits.preload>[0];
    portraits.preload(loader);
    expect(calledWith[0]).toBe("portraits");
  });
});
