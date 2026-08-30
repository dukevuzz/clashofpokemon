import { describe, it, expect } from "vitest";
import * as packs from "../src/core/packs";
import * as cards from "../src/core/cards";
import { RARITY_ORDER } from "../src/core/tiers";

/** A deterministic generator, so a failing case can be re-run. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("opening a pack", () => {
  it("gives a deck's worth of cards", () => {
    const pack = packs.open(mulberry(1));
    expect(pack).toHaveLength(packs.PACK_SIZE);
  });

  it("never gives the same card twice in one pack", () => {
    // Two of a card in one pack is one card and some dust wearing a costume.
    for (let seed = 1; seed <= 200; seed++) {
      const ids = packs.open(mulberry(seed)).map((c) => c.id);
      expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length);
    }
  });

  it("always ends on something worth ending on", () => {
    // PAC's rule, and the reason their boosters feel generous when the odds
    // are not: the last card is never a common.
    for (let seed = 1; seed <= 200; seed++) {
      const last = packs.open(mulberry(seed)).at(-1)!;
      expect(packs.HEADLINE_RARITIES, `seed ${seed}`).toContain(last.rarity);
    }
  });

  it("is the same pack for the same seed", () => {
    expect(packs.open(mulberry(7)).map((c) => c.id))
      .toEqual(packs.open(mulberry(7)).map((c) => c.id));
  });

  it("only ever gives cards a deck could hold", () => {
    const deckable = new Set(cards.ALL.map((c) => c.id));
    for (const c of packs.open(mulberry(3))) expect(deckable).toContain(c.id);
  });

  it("makes a rarer card rarer, per card and all the way down", () => {
    /*
     * Two traps, both specific to this roster.
     *
     * Weighting by tier the way PAC does assumes rarer tiers hold fewer
     * cards. Ours do not -- 30 legendaries, 3 ultras -- so a flat tier
     * percentage makes any given ultra likelier than any given common.
     *
     * And the guaranteed last slot lifts every tier it draws from, which is
     * most of them. A ladder that looks right before the guarantee inverted
     * after it: epic and hatch came out fractionally commoner per card than
     * rare. So the check is the full ordering, measured, not a spot check.
     */
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 6000; seed++) {
      for (const c of packs.open(mulberry(seed))) {
        seen.set(c.rarity, (seen.get(c.rarity) ?? 0) + 1);
      }
    }
    const perCard = (rarity: string) => {
      const size = cards.ALL.filter((c) => c.rarity === rarity).length;
      return size === 0 ? 0 : (seen.get(rarity) ?? 0) / size;
    };

    const ladder = RARITY_ORDER.filter(
      (r) => cards.ALL.some((c) => c.rarity === r));
    for (let i = 1; i < ladder.length; i++) {
      expect(perCard(ladder[i]), `${ladder[i]} vs ${ladder[i - 1]}`)
        .toBeLessThan(perCard(ladder[i - 1]));
    }
  });

  it("keeps a legendary something you remember", () => {
    // Roughly one pack in twelve. The first attempt guaranteed the top two
    // tiers in the last slot and put one in 40% of packs, which is not a
    // legendary, it is a common with a gold border.
    let withLegendary = 0;
    const runs = 4000;
    for (let seed = 1; seed <= runs; seed++) {
      if (packs.open(mulberry(seed)).some((c) => c.rarity === "legendary")) {
        withLegendary++;
      }
    }
    const rate = withLegendary / runs;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.15);
  });

  it("gives every rarity a way in", () => {
    // A tier nothing can ever roll is a tier that should not be in the table.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 3000; seed++) {
      for (const c of packs.open(mulberry(seed))) seen.add(c.rarity);
    }
    for (const r of Object.keys(packs.PER_CARD_WEIGHT)) expect(seen).toContain(r);
  });
});

describe("what a pack is worth", () => {
  it("pays coins for a card already owned, and nothing for a new one", () => {
    const owned = new Set(["pikachu"]);
    const pulled = [cards.byId("pikachu")!, cards.byId("squirtle")!];
    const got = packs.settle(pulled, owned);

    expect(got.fresh.map((c) => c.id)).toEqual(["squirtle"]);
    expect(got.duplicates.map((c) => c.id)).toEqual(["pikachu"]);
    expect(got.coins).toBe(packs.coinsFor(cards.byId("pikachu")!.rarity));
  });

  it("keeps the order the pack was dealt in", () => {
    // The last card is the guaranteed one, and the reveal turns them over in
    // order. Splitting the pack into new and repeated loses that: every
    // duplicate slides to the end, so a pack whose second card was already
    // owned would end on it and the guarantee would be visibly broken.
    const pulled = [cards.byId("pikachu")!, cards.byId("squirtle")!, cards.byId("gastly")!];
    const got = packs.settle(pulled, new Set(["squirtle"]));
    expect(got.pulled.map((c) => c.id)).toEqual(["pikachu", "squirtle", "gastly"]);
  });

  it("pays more for a rarer duplicate", () => {
    expect(packs.coinsFor("legendary")).toBeGreaterThan(packs.coinsFor("common"));
  });

  it("counts a card pulled twice across two packs as a duplicate the second time", () => {
    const owned = new Set<string>();
    const first = packs.settle([cards.byId("pikachu")!], owned);
    for (const c of first.fresh) owned.add(c.id);
    const second = packs.settle([cards.byId("pikachu")!], owned);

    expect(first.coins).toBe(0);
    expect(second.coins).toBeGreaterThan(0);
  });
});
