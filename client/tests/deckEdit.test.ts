import { describe, it, expect } from "vitest";
import * as deckEdit from "../src/core/deckEdit";
import * as cards from "../src/core/cards";
import { config } from "../src/core/config";

const six = cards.ALL.slice(0, config.deckSize);
const ids = (d: deckEdit.DeckSlots) => d.map((c) => c?.id ?? null);

describe("reordering a deck", () => {
  it("moves a card and shifts the rest along", () => {
    const deck = deckEdit.toSlots(six);
    const moved = deckEdit.moveSlot(deck, 4, 0);
    expect(ids(moved)).toEqual([
      six[4].id, six[0].id, six[1].id, six[2].id, six[3].id, six[5].id,
    ]);
  });

  it("moves right as well as left", () => {
    const deck = deckEdit.toSlots(six);
    const moved = deckEdit.moveSlot(deck, 0, 3);
    expect(ids(moved)).toEqual([
      six[1].id, six[2].id, six[3].id, six[0].id, six[4].id, six[5].id,
    ]);
  });

  it("keeps the deck the same size and loses nothing", () => {
    const deck = deckEdit.toSlots(six);
    for (let from = 0; from < 6; from++) {
      for (let to = 0; to < 6; to++) {
        const moved = deckEdit.moveSlot(deck, from, to);
        expect(moved).toHaveLength(config.deckSize);
        expect(new Set(ids(moved))).toEqual(new Set(ids(deck)));
      }
    }
  });

  it("carries empty slots around like any other", () => {
    const deck = deckEdit.clearSlot(deckEdit.toSlots(six), 2);
    const moved = deckEdit.moveSlot(deck, 2, 0);
    expect(ids(moved)[0]).toBeNull();
    expect(moved.filter(Boolean)).toHaveLength(5);
  });

  it("does nothing when the move goes nowhere or off the end", () => {
    const deck = deckEdit.toSlots(six);
    expect(deckEdit.moveSlot(deck, 2, 2)).toBe(deck);
    expect(deckEdit.moveSlot(deck, -1, 0)).toBe(deck);
    expect(deckEdit.moveSlot(deck, 0, 9)).toBe(deck);
  });
});
