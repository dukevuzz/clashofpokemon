import { describe, it, expect } from "vitest";
import { weatherFor, weatherForMatch, weatherBoost, BOOSTS, ALL_WEATHER,
         WEATHER_BY_TYPE, WEATHER_THRESHOLD, type Weather } from "../src/core/weather";
import { ALL } from "../src/core/cards";
import { config } from "../src/core/config";

/** A stand-in deck entry: only the types matter to this module. */
const card = (...types: string[]) => ({ types });
const deckOf = (type: string, n: number, filler = "STEEL") =>
  Array.from({ length: config.deckSize }, (_, i) => card(i < n ? type : filler));

describe("what the sky reads off a deck", () => {
  it("gives no weather to a deck that commits to nothing", () => {
    expect(weatherFor(deckOf("FIRE", WEATHER_THRESHOLD - 1))).toBeNull();
  });

  it("turns on at the threshold, not before", () => {
    expect(weatherFor(deckOf("FIRE", WEATHER_THRESHOLD - 1))).toBeNull();
    expect(weatherFor(deckOf("FIRE", WEATHER_THRESHOLD))).toBe("DROUGHT");
  });

  it("gives no weather on a tie, which is what stops the sky flickering", () => {
    // Both reach the threshold. Neither wins, so nothing happens -- the rule
    // Pokemon Auto Chess uses, and the reason its weather does not strobe.
    const tied = [
      card("FIRE"), card("FIRE"), card("FIRE"), card("FIRE"),
      card("WATER"), card("WATER"), card("WATER"), card("WATER"),
    ];
    expect(weatherFor(tied)).toBeNull();
  });

  it("lets a clear majority win over a type that also reaches the threshold", () => {
    const deck = [
      card("FIRE"), card("FIRE"), card("FIRE"), card("FIRE"), card("FIRE"),
      card("WATER"), card("WATER"), card("WATER"), card("WATER"),
    ];
    expect(weatherFor(deck)).toBe("DROUGHT");
  });

  it("counts a dual-type card for both of its types", () => {
    const deck = [
      card("FIRE", "FLYING"), card("FIRE", "FLYING"),
      card("FIRE", "FLYING"), card("FIRE", "FLYING"),
    ];
    // FIRE and FLYING are level with each other, so neither claims the sky.
    expect(weatherFor(deck)).toBeNull();
  });

  it("ignores types no weather is mapped to", () => {
    expect(weatherFor(deckOf("STEEL", config.deckSize, "STEEL"))).toBeNull();
    expect(weatherFor(deckOf("ROCK", config.deckSize, "ROCK"))).toBeNull();
  });

  it("treats NORMAL as no weather rather than as a weather called neutral", () => {
    // PAC maps NORMAL to a NEUTRAL weather. A neutral sky is the absence of
    // one, so it is not worth a render pass or a name in the UI.
    expect(WEATHER_BY_TYPE.NORMAL).toBeUndefined();
    expect(weatherFor(deckOf("NORMAL", config.deckSize, "NORMAL"))).toBeNull();
  });

  it("is stable: the same deck always reads the same sky", () => {
    const deck = deckOf("WATER", WEATHER_THRESHOLD);
    const once = weatherFor(deck);
    for (let i = 0; i < 50; i++) expect(weatherFor(deck)).toBe(once);
  });
});

describe("what the roster can actually trigger", () => {
  it("maps every weather to at least one playable card", () => {
    const reachable = new Set<Weather>();
    for (const c of ALL)
      for (const t of c.types) {
        const w = WEATHER_BY_TYPE[t];
        if (w) reachable.add(w);
      }
    for (const w of new Set(Object.values(WEATHER_BY_TYPE)))
      expect(reachable, `no card can trigger ${w}`).toContain(w);
  });

  it("can be triggered by a legal deck of six", () => {
    // A weather nothing can reach with a real deck is decoration, not a rule.
    for (const w of new Set(Object.values(WEATHER_BY_TYPE))) {
      const type = Object.keys(WEATHER_BY_TYPE).find((t) => WEATHER_BY_TYPE[t] === w)!;
      const have = ALL.filter((c) => c.types.includes(type)).length;
      expect(have, `${type} has too few cards to ever reach the threshold`)
        .toBeGreaterThanOrEqual(WEATHER_THRESHOLD);
    }
  });
});

describe("what a weather does to damage", () => {
  it("leaves everything alone when there is no weather", () => {
    for (const t of ["FIRE", "WATER", "STEEL", "GRASS"])
      expect(weatherBoost(null, [t])).toBe(1);
  });

  it("boosts the type that summoned it", () => {
    expect(weatherBoost("DROUGHT", ["FIRE"])).toBeGreaterThan(1);
    expect(weatherBoost("RAIN", ["WATER"])).toBeGreaterThan(1);
    expect(weatherBoost("SNOW", ["ICE"])).toBeGreaterThan(1);
  });

  it("damps the type that answers it", () => {
    // Rain quenches fire, sun boils off water. Canon, and legible without a
    // tooltip, which is the whole reason for picking the counter this way.
    expect(weatherBoost("RAIN", ["FIRE"])).toBeLessThan(1);
    expect(weatherBoost("DROUGHT", ["WATER"])).toBeLessThan(1);
  });

  it("leaves a type the weather has no opinion about at 1", () => {
    expect(weatherBoost("DROUGHT", ["STEEL"])).toBe(1);
    expect(weatherBoost("RAIN", ["PSYCHIC"])).toBe(1);
  });

  it("is symmetric: what it gives one type it takes from the other", () => {
    // Not decoration -- an asymmetric pair silently inflates or deflates the
    // total damage in every match that weather appears in.
    for (const w of ALL_WEATHER) {
      const up = BOOSTS[w].up, down = BOOSTS[w].down;
      expect(weatherBoost(w, [up]) * weatherBoost(w, [down])).toBeCloseTo(1, 5);
    }
  });

  it("takes the better of a dual type's two claims", () => {
    // A Fire/Water card in drought is boosted, not averaged into nothing.
    expect(weatherBoost("DROUGHT", ["FIRE", "WATER"]))
      .toBe(weatherBoost("DROUGHT", ["FIRE"]));
  });

  it("never boosts and damps the same card twice", () => {
    for (const w of ALL_WEATHER) {
      const b = weatherBoost(w, [BOOSTS[w].up, BOOSTS[w].down]);
      expect(b).toBe(weatherBoost(w, [BOOSTS[w].up]));
    }
  });

  it("keeps the swing inside the band we chose to tune in", () => {
    // The ceiling is deliberate. The type chart already reaches 4x, and Clash
    // Royale's compounding per-level multipliers are its most criticised
    // feature. Weather is meant to tilt a match, not decide it.
    for (const w of ALL_WEATHER) {
      expect(weatherBoost(w, [BOOSTS[w].up])).toBeLessThanOrEqual(1.25);
      expect(weatherBoost(w, [BOOSTS[w].down])).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("gives every weather both a type to boost and a type to damp", () => {
    for (const w of ALL_WEATHER) {
      expect(BOOSTS[w], `${w} has no entry`).toBeDefined();
      expect(BOOSTS[w].up).not.toBe(BOOSTS[w].down);
    }
  });
});

describe("the sky both players share", () => {
  it("reads one weather from both decks together", () => {
    const mine = Array.from({ length: 6 }, () => card("FIRE"));
    const theirs = Array.from({ length: 6 }, () => card("STEEL"));
    expect(weatherForMatch(mine, theirs)).toBe("DROUGHT");
  });

  it("lets an opponent deny the sky by answering it", () => {
    // Four Fire against four Water is a tie, and a tie is no weather. This is
    // the counterplay: committing to a type can be answered by committing to
    // the type that opposes it.
    const mine = [card("FIRE"), card("FIRE"), card("FIRE"), card("FIRE"), card("STEEL"), card("STEEL")];
    const theirs = [card("WATER"), card("WATER"), card("WATER"), card("WATER"), card("STEEL"), card("STEEL")];
    expect(weatherForMatch(mine, theirs)).toBeNull();
  });

  it("buffs both players when both brought the same type", () => {
    // A mirror match lights the sky up and boosts everyone equally, so it
    // decides nothing -- but it is not a bug. Six Water a side is the most
    // committed a Rain match can be, and it should look like it.
    const water = () => Array.from({ length: 6 }, () => card("WATER"));
    expect(weatherForMatch(water(), water())).toBe("RAIN");
  });

  it("can be triggered by two decks that each fall short alone", () => {
    // Three and three reaches four together. You can be handed a sky you did
    // not commit to -- symmetric, so it favours neither seat, and it means the
    // count that matters is the one on the board rather than in your hand.
    const half = [card("FIRE"), card("FIRE"), card("FIRE"),
                  card("STEEL"), card("STEEL"), card("STEEL")];
    expect(weatherFor(half)).toBeNull();
    expect(weatherForMatch(half, half)).toBe("DROUGHT");
  });

  it("does not care which side is asked first", () => {
    // Both clients render the same arena, so the answer cannot depend on seat.
    const a = Array.from({ length: 6 }, () => card("WATER"));
    const b = [card("FIRE"), card("FIRE"), card("STEEL"), card("STEEL"), card("STEEL"), card("STEEL")];
    expect(weatherForMatch(a, b)).toBe(weatherForMatch(b, a));
  });
});

// --------------------------------------------------------------- in a match

import { Match } from "../src/core/match";
import * as combat from "../src/core/combat";
import { byId } from "../src/core/cards";

const cardsOf = (ids: string[]) => ids.map((id) => {
  const c = byId(id); if (!c) throw new Error(`no card ${id}`); return c;
});

/** A match whose decks are chosen to produce (or refuse) a weather. */
function matchWith(one: string[], two: string[]) {
  return new Match({
    playerDeck: cardsOf(one), enemyDeck: cardsOf(two),
    shuffle: false, bot: {},
  });
}

// Six Fire cards between them is over the threshold and nothing opposes it.
const FIRE_SIX = ["charmander", "fennekin", "litwick", "growlithe", "capsakid", "larvesta"];
// Steel and Psychic map to no weather at all, so these decks cannot claim a sky.
const QUIET_SIX = ["aron", "honedge", "riolu", "bronzor", "beldum", "drilbur"];

describe("a match under weather", () => {
  it("reads its sky once, from both decks", () => {
    expect(matchWith(FIRE_SIX, QUIET_SIX).weather).toBe("DROUGHT");
  });

  it("has no weather when neither deck reaches the threshold", () => {
    expect(matchWith(QUIET_SIX, QUIET_SIX).weather).toBeNull();
  });

  it("does not change its sky once the match is running", () => {
    // Fixed at the start on purpose. A weather that moved would be match-wide
    // state to keep in step across a connection; a weather that does not is a
    // parameter, like the decks themselves.
    const m = matchWith(FIRE_SIX, QUIET_SIX);
    const at_start = m.weather;
    for (let i = 0; i < 120; i++) m.update(1 / 30);
    expect(m.weather).toBe(at_start);
  });

  it("hits harder with the favoured type than the same match with no weather", () => {
    const lit = matchWith(FIRE_SIX, QUIET_SIX);
    const dark = matchWith(QUIET_SIX, QUIET_SIX);
    const fire = { card: { sheet: "charmander" } } as never;
    const target = { card: { sheet: "bronzor" } } as never;

    const under = combat.matchup(lit, fire, target);
    const without = combat.matchup(dark, fire, target);
    expect(under).toBeGreaterThan(without);
    expect(under / without).toBeCloseTo(1.2, 5);
  });

  it("leaves a type the sky has no opinion about exactly as it was", () => {
    const lit = matchWith(FIRE_SIX, QUIET_SIX);
    const dark = matchWith(QUIET_SIX, QUIET_SIX);
    const steel = { card: { sheet: "aron" } } as never;
    const target = { card: { sheet: "bronzor" } } as never;
    expect(combat.matchup(lit, steel, target)).toBe(combat.matchup(dark, steel, target));
  });

  it("still returns 1 when either side has no card to read a type from", () => {
    // Towers are structures with no typing, and weather must not invent one
    // for them -- that would make the tower race turn on the sky.
    const lit = matchWith(FIRE_SIX, QUIET_SIX);
    const tower = {} as never;
    const fire = { card: { sheet: "charmander" } } as never;
    expect(combat.matchup(lit, fire, tower)).toBe(1);
    expect(combat.matchup(lit, tower, fire)).toBe(1);
  });
});
