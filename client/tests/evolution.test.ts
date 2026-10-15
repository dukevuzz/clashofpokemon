/**
 * The chains the source data leaves open.
 *
 * `species.json` records an `evolution` for most of the roster, but not for
 * all of it -- a handful of lines arrive with the field missing even though
 * both forms are present and drawable. A card in that position never changes
 * no matter how many times it is played, which reads as a balance decision
 * and is really a hole in the data. `EXTRA_EVOLUTION` is where we close them,
 * and this file is the record of which ones we closed and why.
 */

import { describe, expect, it } from "vitest";
import { nextOf, evolve, lineOf, stageOf } from "../src/core/evolution";
import { SPECIES } from "../src/core/species";
import { byId } from "../src/core/cards";

/** Chains the source omits, which we supply by hand. */
const SUPPLIED: ReadonlyArray<readonly [string, string]> = [
  ["pikachu", "raichu"],
  ["koffing", "weezing"],
  ["exeggcute", "exeggutor"],
];

describe("the chains species.json leaves open", () => {
  it.each(SUPPLIED)("%s evolves into %s", (from, into) => {
    expect(nextOf(from)).toBe(into);
  });

  it.each(SUPPLIED)("%s -> %s is a real card, not just a name", (from, into) => {
    const base = byId(from);
    expect(base, `${from} is not in the roster`).toBeTruthy();

    const grown = evolve(base!);
    expect(grown, `${from} has no drawable ${into}`).toBeTruthy();
    expect(grown!.id).toBe(into);
  });

  it.each(SUPPLIED)("%s -> %s climbs exactly one stage", (from, into) => {
    expect(stageOf(into)).toBe(stageOf(from) + 1);
  });

  it.each(SUPPLIED)("%s and %s share one line, walked either way", (from, into) => {
    expect(lineOf(from)).toContain(into);
    expect(lineOf(into)).toContain(from);
  });

  it("every supplied chain is genuinely absent upstream", () => {
    // If the source ever gains these, the override becomes dead weight that
    // silently shadows real data. Fail loudly rather than carry it.
    for (const [from] of SUPPLIED) {
      expect(
        SPECIES[from]?.evolution,
        `species.json now records an evolution for ${from} -- drop the override`,
      ).toBeFalsy();
    }
  });
});
