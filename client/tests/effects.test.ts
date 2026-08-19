/**
 * The effect atlas.
 *
 * Effects were 71 strips laid out one per row, every frame padded to a uniform
 * cell. That put 67% of the sheet in empty space and made the texture as wide
 * as the longest animation -- 6216px, past the 4096 limit older mobile GPUs
 * still have, which means the whole sheet fails to upload and *every* effect
 * disappears at once.
 *
 * Trimming each frame to its opaque box fixed that, and introduced a new way to
 * be wrong: a trimmed frame has to remember the offset it was cut from, or it
 * drifts across the screen as it plays. That is invisible in a screenshot and
 * obvious in motion, so it is asserted here rather than looked for by eye.
 */

import { describe, it, expect } from "vitest";
import { FRAMES, ABILITY_FX, ATTACKS, referencedFrames } from "../src/data/effects";
import { ALL, build } from "../src/core/cards";
import * as evolution from "../src/core/evolution";

describe("every effect has the frames it claims", () => {
  it("nothing an effect names is missing from the atlas", () => {
    const missing = referencedFrames().filter((f) => !FRAMES[f]);
    // Phaser drops frames it cannot resolve rather than erroring, so a missing
    // one shows up as an animation that plays short -- or not at all.
    expect(missing).toEqual([]);
  });

  it("references a sane number of frames", () => {
    const n = referencedFrames().length;
    expect(n).toBeGreaterThan(500);
    expect(Object.keys(FRAMES).length).toBeGreaterThanOrEqual(n);
  });

  it("no effect declares zero frames", () => {
    for (const [name, info] of Object.entries(ABILITY_FX)) {
      expect(info.frames, name).toBeGreaterThan(0);
    }
    for (const [el, kinds] of Object.entries(ATTACKS)) {
      for (const [kind, info] of Object.entries(kinds)) {
        expect(info.frames, `${el}/${kind}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("trimmed frames stay where they were cut from", () => {
  it("no frame's offset puts it outside its own cell", () => {
    const strayed: string[] = [];
    for (const [name, f] of Object.entries(FRAMES)) {
      const [, , w, h, ox, oy, sw, sh] = f;
      // +1 for the rounding the packer's padding can introduce.
      if (ox + w > sw + 1 || oy + h > sh + 1) strayed.push(name);
    }
    expect(strayed).toEqual([]);
  });

  it("every frame has a positive size and a non-negative offset", () => {
    for (const [name, f] of Object.entries(FRAMES)) {
      const [x, y, w, h, ox, oy] = f;
      expect(w, name).toBeGreaterThan(0);
      expect(h, name).toBeGreaterThan(0);
      expect(x, name).toBeGreaterThanOrEqual(0);
      expect(y, name).toBeGreaterThanOrEqual(0);
      expect(ox, name).toBeGreaterThanOrEqual(0);
      expect(oy, name).toBeGreaterThanOrEqual(0);
    }
  });

  it("stays inside a 4096 texture", () => {
    // The reason for trimming at all. A sheet wider than this does not upload
    // on the GPUs that cap there, and nothing about it fails loudly.
    let maxX = 0, maxY = 0;
    for (const [x, y, w, h] of Object.values(FRAMES)) {
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    expect(maxX).toBeLessThanOrEqual(4096);
    expect(maxY).toBeLessThanOrEqual(4096);
  });
});

describe("the roster's own casts are covered", () => {
  const skills = (() => {
    const s = new Set<string>();
    for (const c of ALL) for (const f of evolution.chainOf(c.id) ?? [c.id]) s.add(build(f).skill);
    return [...s];
  })();

  it("a skill with a bespoke effect has all of its frames packed", () => {
    for (const skill of skills) {
      const info = ABILITY_FX[skill];
      if (!info) continue;               // falls back to the procedural ring
      for (let i = 0; i < info.frames; i++) {
        expect(FRAMES[`${info.sheet}/${i}`], `${skill} frame ${i}`).toBeDefined();
      }
    }
  });

  it("every element a creature can be has a generic attack effect", () => {
    // An ordinary swing draws one of these. A missing element means a whole
    // type attacks with nothing showing.
    for (const el of Object.keys(ATTACKS)) {
      for (const kind of ["melee", "range", "hit"]) {
        const info = ATTACKS[el]?.[kind];
        if (!info) continue;
        expect(FRAMES[`${info.sheet}/0`], `${el}/${kind}`).toBeDefined();
      }
    }
  });
});
