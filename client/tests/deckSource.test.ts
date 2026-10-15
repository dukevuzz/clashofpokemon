/**
 * Two modes, one deck screen.
 *
 * The screen was written against `cards.ALL` and the lane deck's storage, in
 * three separate places. Forking it for the arena would have meant two copies
 * of drag-to-reorder, filtering and slot logic drifting apart. Instead the
 * roster and its storage are a parameter -- a `DeckSource` -- and the arena is
 * a different value, not a different screen.
 *
 * These are the two values. The screen is checked end-to-end in the e2e specs;
 * what matters here is that the two sources are genuinely distinct and that
 * neither can write into the other's storage.
 */

import { describe, it, expect, beforeEach } from "vitest";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

const { LANE_SOURCE, ARENA_SOURCE } = await import("../src/ui/deckSource");
const cards = await import("../src/core/cards");
const { ARENA_ALL } = await import("../src/core/arenaRoster");

beforeEach(() => store.clear());

describe("the two deck sources", () => {
  it("offer different rosters", () => {
    expect(LANE_SOURCE.roster).toHaveLength(cards.ALL.length);
    expect(ARENA_SOURCE.roster).toHaveLength(ARENA_ALL.length);
    expect(ARENA_SOURCE.roster.length).toBeGreaterThan(LANE_SOURCE.roster.length);
  });

  it("only the arena offers creatures the lane cannot deck", () => {
    const laneIds = new Set(LANE_SOURCE.roster.map((c) => c.id));
    const arenaIds = new Set(ARENA_SOURCE.roster.map((c) => c.id));
    // Charizard is reachable in a lane match only by evolving Charmander.
    expect(laneIds.has("charizard")).toBe(false);
    expect(arenaIds.has("charizard")).toBe(true);
  });

  it("write to separate storage", () => {
    LANE_SOURCE.save([LANE_SOURCE.roster[0]]);
    ARENA_SOURCE.save([ARENA_SOURCE.roster[0]]);
    expect(LANE_SOURCE.load()[0].id).toBe(LANE_SOURCE.roster[0].id);
    expect(ARENA_SOURCE.load()[0].id).toBe(ARENA_SOURCE.roster[0].id);
  });

  it("do not disturb each other", () => {
    ARENA_SOURCE.save([ARENA_SOURCE.roster[5], ARENA_SOURCE.roster[6]]);
    const before = ARENA_SOURCE.load().map((c) => c.id);
    LANE_SOURCE.save(LANE_SOURCE.starter());
    expect(ARENA_SOURCE.load().map((c) => c.id)).toEqual(before);
  });

  it("each hand back a full starter", () => {
    expect(LANE_SOURCE.starter().length).toBeGreaterThan(0);
    expect(ARENA_SOURCE.starter().length).toBeGreaterThan(0);
  });

  it("offer the Eevee branch picker in the lane only", () => {
    // The lane has to ask which eeveelution, because Eevee evolves mid-match
    // and the match cannot stop to ask. The arena never evolves anything --
    // you pick Vaporeon directly, so the question does not exist.
    expect(LANE_SOURCE.branches).toBe(true);
    expect(ARENA_SOURCE.branches).toBe(false);
  });

  it("name themselves, for the heading", () => {
    expect(LANE_SOURCE.title).toBeTruthy();
    expect(ARENA_SOURCE.title).toBeTruthy();
    expect(ARENA_SOURCE.title).not.toBe(LANE_SOURCE.title);
  });
});

describe("elixir is a lane idea", () => {
  it("is shown for the lane deck and not for the arena team", () => {
    // The arena charges nothing to send a creature out, so an average cost
    // there would be a number that describes no rule in that mode.
    expect(LANE_SOURCE.costs).toBe(true);
    expect(ARENA_SOURCE.costs).toBe(false);
  });
});
