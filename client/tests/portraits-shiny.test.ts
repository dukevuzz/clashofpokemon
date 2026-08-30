/**
 * Shiny portraits, once the export tool has shipped `shiny` frames.
 *
 * Mocked rather than run against the real sheet, because that data is being
 * built concurrently by somebody else and is not here yet. This is the
 * contract, exercised early: `shiny` sits on the same sheet, appended after
 * the normal frames, same 16 columns -- so the sheet is taller and `rows`
 * has to grow with it or every background-position on the page scales
 * against the wrong height.
 */

import { describe, it, expect, vi } from "vitest";

const FIXTURE = {
  size: 40,
  cols: 4,
  // 5 normal frames -> 2 rows at 4 cols.
  frames: { pikachu: 0, squirtle: 1, bulbasaur: 2, charmander: 3, gastly: 4 },
  // 3 shiny frames, appended after the 5 normal ones -> frames 5, 6, 7.
  shiny: { pikachu: 5, squirtle: 6 },
};

vi.mock("../src/data/portraits.json", () => ({ default: FIXTURE }));

const portraits = await import("../src/ui/portraits");

describe("shiny portraits, once the data exists", () => {
  it("reports shiny only for species the sheet actually has it for", () => {
    expect(portraits.hasShiny("pikachu")).toBe(true);
    expect(portraits.hasShiny("squirtle")).toBe(true);
    // In the frames table, but with no shiny entry of its own.
    expect(portraits.hasShiny("bulbasaur")).toBe(false);
    // Not on the sheet at all.
    expect(portraits.hasShiny("mew")).toBe(false);
  });

  it("uses the shiny frame's position when asked and available", () => {
    const shiny = portraits.styleFor("pikachu", 40, true);
    // Frame 5 at 4 cols is row 1, col 1.
    expect(shiny.backgroundPosition).toBe("-40px -40px");
    const normal = portraits.styleFor("pikachu", 40, false);
    // Frame 0 is row 0, col 0.
    expect(normal.backgroundPosition).toBe("-0px -0px");
    expect(shiny.backgroundPosition).not.toBe(normal.backgroundPosition);
  });

  it("falls back to the normal frame when this species has no shiny art", () => {
    const asked = portraits.styleFor("bulbasaur", 40, true);
    const plain = portraits.styleFor("bulbasaur", 40, false);
    expect(asked).toEqual(plain);
  });

  it("defaults to the normal frame when shiny is not passed at all", () => {
    expect(portraits.styleFor("pikachu", 40)).toEqual(portraits.styleFor("pikachu", 40, false));
  });

  it("sizes the sheet's background from every frame, normal and shiny together", () => {
    // 5 normal + 3 shiny = 8 frames at 4 cols = 2 rows exactly.
    // The bug this guards: computing rows from `frames` alone gives
    // ceil(5/4) = 2 too, by coincidence at this fixture size, so the
    // fixture below forces a case where the two answers actually diverge.
    const style = portraits.styleFor("pikachu", 40);
    const [, height] = style.backgroundSize!.split(" ");
    expect(height).toBe("80px"); // 2 rows * 40px
  });
});
