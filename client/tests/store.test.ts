/**
 * What survives a save and a load.
 *
 * This file exists because the same bug shipped more than once: a choice you
 * made in the deck builder came back different. The last one was reported as "I
 * click a card to remove it and instead something else gets added to the deck",
 * and the click handler was innocent -- `loadDeck` topped a short deck back up
 * from `cards.ALL`, so a deliberate removal was refilled with an arbitrary card
 * on the very next read.
 *
 * The shape of the bug is always the same and never in the widget: **what you
 * saved is not what you load.** Storage is the only place all of it meets, so
 * the properties are asserted here rather than through a screen.
 *
 * The rule these encode: everything read back out of storage is a value written
 * by a *previous version of the roster*, so it is input, not state. It gets
 * validated exactly like input.
 */

import { describe, it, expect, beforeEach } from "vitest";

// A stub, because the store is the unit under test and jsdom is not needed for
// a Map with four methods.
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
  loadDeck, saveDeck, deckIsFull, starterDeck,
  loadBranch, saveBranch, loadTroop, saveTroop,
  loadSettings, saveSettings, loadRecord, recordResult,
} = await import("../src/ui/deckStore");
const cards = await import("../src/core/cards");
const { config } = await import("../src/core/config");
const { TROOPS, DEFAULT_TROOP } = await import("../src/core/towerTroops");
const { branchesFor } = await import("../src/core/evolution");

const KEY = "clashofpokemon.deck";

beforeEach(() => store.clear());

describe("the deck survives the round trip", () => {
  it("keeps a full deck exactly as saved, in order", () => {
    const deck = cards.ALL.slice(0, config.deckSize);
    saveDeck(deck);
    expect(loadDeck().map((c) => c.id)).toEqual(deck.map((c) => c.id));
  });

  it("a removed card stays removed", () => {
    // The reported bug, as a test. A five-card deck must load as five cards --
    // topping it up invents a choice the player did not make, and the card it
    // invents changes whenever the roster does.
    const deck = cards.ALL.slice(0, config.deckSize);
    saveDeck(deck.filter((c) => c !== deck[4]));

    const back = loadDeck();
    expect(back).toHaveLength(config.deckSize - 1);
    expect(back.map((c) => c.id)).not.toContain(deck[4].id);
  });

  it("never invents a card that was not chosen", () => {
    const kept = cards.ALL.slice(0, 3);
    saveDeck(kept);
    for (const c of loadDeck()) expect(kept).toContain(c);
  });

  it("a short deck cannot be played, a full one can", () => {
    expect(deckIsFull(cards.ALL.slice(0, config.deckSize - 1))).toBe(false);
    expect(deckIsFull(cards.ALL.slice(0, config.deckSize))).toBe(true);
  });

  it("gives a new player a full starter deck", () => {
    expect(loadDeck()).toHaveLength(config.deckSize);
    expect(starterDeck()).toHaveLength(config.deckSize);
  });

  it("an emptied deck stays empty", () => {
    // The same bug as "a removed card stays removed", one case further on, and
    // it survived the first fix. Clearing every slot saves `[]`, and an empty
    // saved deck is not a new player -- `getItem` returns null for one and "[]"
    // for the other. Conflating them resurrected six cards nobody picked, which
    // is the loudest possible version of the original report.
    saveDeck([]);
    expect(loadDeck()).toHaveLength(0);
  });

  it("still starts a never-played player off with a deck", () => {
    store.clear();               // no key at all, as opposed to an empty one
    expect(loadDeck()).toHaveLength(config.deckSize);
  });

  it("returns identical card objects, not copies", () => {
    // The deck builder asks `deck.indexOf(card)` to decide whether a tap adds
    // or removes. A structurally equal copy would answer -1 and silently turn
    // every removal into an add.
    saveDeck(cards.ALL.slice(0, config.deckSize));
    for (const c of loadDeck()) expect(cards.ALL).toContain(c);
  });
});

describe("storage is input, not state", () => {
  it("drops ids that are no longer on the roster", () => {
    localStorage.setItem(KEY, JSON.stringify(["charmander", "not-a-pokemon"]));
    const back = loadDeck();
    expect(back.map((c) => c.id)).toEqual(["charmander"]);
  });

  it("drops duplicates", () => {
    localStorage.setItem(KEY, JSON.stringify(["charmander", "charmander"]));
    expect(loadDeck()).toHaveLength(1);
  });

  it("survives a corrupt deck without throwing", () => {
    localStorage.setItem(KEY, "{not json");
    expect(() => loadDeck()).not.toThrow();
    expect(loadDeck()).toHaveLength(config.deckSize); // falls back to the starter
  });

  it("never returns more than a deck's worth", () => {
    saveDeck(cards.ALL.slice(0, config.deckSize + 4));
    expect(loadDeck().length).toBeLessThanOrEqual(config.deckSize);
  });
});

describe("the other saved choices are validated too", () => {
  it("keeps a real Eevee branch", () => {
    const real = branchesFor("eevee")?.[0];
    expect(real).toBeDefined();
    saveBranch(real);
    expect(loadBranch()).toBe(real);
  });

  it("forgets a branch that is no longer offered", () => {
    // Unvalidated, this returned an id that never matches the offer, so the
    // game asked you to choose again every match after you had chosen.
    localStorage.setItem("clashofpokemon.branch", "gone-eon");
    expect(loadBranch()).toBeUndefined();
  });

  it("keeps a real tower troop", () => {
    saveTroop(TROOPS[1].id);
    expect(loadTroop()).toBe(TROOPS[1].id);
  });

  it("falls back for a troop that no longer exists", () => {
    // `troopById` already fell back for an unknown id, but silently: the menu
    // highlighted nothing while the match used a troop nobody picked.
    localStorage.setItem("clashofpokemon.troop", "gone-mon");
    expect(loadTroop()).toBe(DEFAULT_TROOP);
    expect(TROOPS.some((t) => t.id === loadTroop())).toBe(true);
  });
});

describe("settings and the win record", () => {
  it("defaults to hiding the opponent's elixir", () => {
    // Clash Royale's rule, and the skill it protects: counting their elixir is
    // most of reading an opponent. Offered as a setting, off by default.
    expect(loadSettings().showEnemyElixir).toBe(false);
  });

  it("remembers the setting across a load", () => {
    saveSettings({ showEnemyElixir: true });
    expect(loadSettings().showEnemyElixir).toBe(true);
  });

  it("fills in a field a newer build added", () => {
    // What comes out of storage was written by a previous version, so it is
    // input rather than state -- a partial object must not become a missing
    // property somewhere far away.
    localStorage.setItem("clashofpokemon.settings", "{}");
    expect(loadSettings()).toEqual({ showEnemyElixir: false });
  });

  it("survives unreadable settings rather than failing a launch", () => {
    localStorage.setItem("clashofpokemon.settings", "{not json");
    expect(loadSettings().showEnemyElixir).toBe(false);
  });

  it("starts a record at zero", () => {
    expect(loadRecord()).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it("counts each result in its own column", () => {
    recordResult("player");
    recordResult("player");
    recordResult("enemy");
    recordResult("draw");
    expect(loadRecord()).toEqual({ wins: 2, losses: 1, draws: 1 });
  });

  it("fills in a missing column rather than producing NaN", () => {
    // A record written before draws existed must not make every later count
    // undefined + 1.
    localStorage.setItem("clashofpokemon.record", JSON.stringify({ wins: 3 }));
    expect(loadRecord()).toEqual({ wins: 3, losses: 0, draws: 0 });
    recordResult("draw");
    expect(loadRecord()).toEqual({ wins: 3, losses: 0, draws: 1 });
  });

  it("survives an unreadable record", () => {
    localStorage.setItem("clashofpokemon.record", "]]not json[[");
    expect(loadRecord()).toEqual({ wins: 0, losses: 0, draws: 0 });
  });
});
