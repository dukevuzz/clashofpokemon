/**
 * The arena team, remembered separately from the lane deck.
 *
 * Two modes, two rosters, two stored decks. Clash Royale does the same thing
 * and for the same reason: a deck built for one mode is not a deck for the
 * other, and sharing one key means editing an arena team silently rewrites
 * the deck you take into a lane match.
 *
 * Everything here is the same contract `store.test.ts` encodes for the lane
 * deck -- what you saved is what you load, and anything read back out of
 * storage is input from a previous version of the roster, not state.
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

const {
  loadArenaDeck, saveArenaDeck, starterArenaDeck, loadDeck, saveDeck,
} = await import("../src/ui/deckStore");
const { ARENA_ALL, arenaById } = await import("../src/core/arenaRoster");
const { config } = await import("../src/core/config");

beforeEach(() => store.clear());

describe("the arena team is its own deck", () => {
  it("does not share a key with the lane deck", () => {
    const lane = loadDeck();
    saveArenaDeck([arenaById("charizard")!, arenaById("blastoise")!]);
    // The lane deck is untouched by an arena save. This is the whole point.
    expect(loadDeck().map((c) => c.id)).toEqual(lane.map((c) => c.id));
  });

  it("does not let a lane save clobber the arena team", () => {
    const team = [arenaById("gengar")!, arenaById("alakazam")!];
    saveArenaDeck(team);
    saveDeck(loadDeck());
    expect(loadArenaDeck().map((c) => c.id)).toEqual(["gengar", "alakazam"]);
  });

  it("gives a new player a full team rather than nothing", () => {
    expect(loadArenaDeck()).toHaveLength(config.deckSize);
  });

  it("hands back an empty team to someone who emptied it", () => {
    // Absent is not the same as empty -- the lane deck shipped this bug twice.
    saveArenaDeck([]);
    expect(loadArenaDeck()).toEqual([]);
  });

  it("drops ids that are no longer in the arena roster", () => {
    localStorage.setItem(
      "clashofpokemon.arenaDeck",
      JSON.stringify(["charizard", "nosuchcreature", "gengar"]),
    );
    expect(loadArenaDeck().map((c) => c.id)).toEqual(["charizard", "gengar"]);
  });

  it("falls back to a starter when every saved id has gone", () => {
    localStorage.setItem("clashofpokemon.arenaDeck", JSON.stringify(["gone", "alsogone"]));
    expect(loadArenaDeck()).toHaveLength(config.deckSize);
  });

  it("survives a corrupt store without failing the launch", () => {
    localStorage.setItem("clashofpokemon.arenaDeck", "{not json");
    expect(loadArenaDeck()).toHaveLength(config.deckSize);
  });

  it("round-trips a team built from the full roster", () => {
    // Charizard is not in the lane roster at all; it is only reachable there
    // by evolving. In the arena it is an entry you pick.
    const team = ["charizard", "gengar", "alakazam", "gyarados", "blastoise", "venusaur"]
      .map((id) => arenaById(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    saveArenaDeck(team);
    expect(loadArenaDeck().map((c) => c.id)).toEqual(team.map((c) => c.id));
  });

  it("never stores more than a team's worth", () => {
    saveArenaDeck(ARENA_ALL.slice(0, 20));
    expect(loadArenaDeck().length).toBeLessThanOrEqual(config.deckSize);
  });
});

describe("the starter arena team", () => {
  it("is a full team of creatures that exist", () => {
    const team = starterArenaDeck();
    expect(team).toHaveLength(config.deckSize);
    for (const c of team) expect(arenaById(c.id), `${c.id} is not in the roster`).toBeTruthy();
  });

  it("has no duplicates", () => {
    const ids = starterArenaDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is made of final forms, so a new player is not walked into a 2% fight", () => {
    // The measured reason this mode needed its own roster: a stage-1 wins
    // about 2% of bouts against a stage-3, because skill damage is indexed
    // by stage. A starter team of babies would be a losing tutorial.
    for (const c of starterArenaDeck()) {
      expect(c.stage, `${c.id} is stage ${c.stage}`).toBeGreaterThanOrEqual(2);
    }
  });
});
