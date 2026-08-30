/**
 * The specific bug called out for this change: `rows` computed from
 * `Object.keys(DATA.frames).length` alone is wrong once shiny frames are
 * appended below the normal ones on the same sheet. This fixture is picked
 * so the frames-only answer and the true answer disagree, so a regression
 * back to the old formula fails loudly rather than passing by coincidence.
 *
 * Its own file: it needs its own top-level `vi.mock` of the JSON module,
 * separate from `portraits-shiny.test.ts`'s fixture.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../src/data/portraits.json", () => ({
  default: {
    size: 10,
    cols: 4,
    // 4 normal frames -> ceil(4/4) = 1 row if `shiny` were ignored.
    frames: { a: 0, b: 1, c: 2, d: 3 },
    // 4 more shiny frames appended after them -> 8 frames total -> 2 rows.
    shiny: { a: 4, b: 5, c: 6, d: 7 },
  },
}));

const portraits = await import("../src/ui/portraits");

describe("rows, once shiny frames make the sheet taller", () => {
  it("is computed from the total frame count, not `frames` alone", () => {
    const style = portraits.styleFor("a", 10);
    const [, height] = style.backgroundSize!.split(" ");
    // The old formula (frames only) would say "10px" -- one row -- and every
    // background-position on the page would be measured against a sheet
    // shorter than the one that actually shipped.
    expect(height).toBe("20px");
  });

  it("still positions a shiny frame correctly against the taller sheet", () => {
    const shiny = portraits.styleFor("a", 10, true);
    // Frame 4 at 4 cols is row 1, col 0.
    expect(shiny.backgroundPosition).toBe("-0px -10px");
  });
});
