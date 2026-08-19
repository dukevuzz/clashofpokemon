/**
 * Deck editing, hammered.
 *
 * The bug a player kept hitting -- "I click a card to remove and instead
 * something else gets added" -- was never reproduced by reading the code. It
 * was found by asking what a save and a load do to a deck, and then again by
 * asking what happens when every slot is emptied.
 *
 * So this does not test that `tapCard` returns the right thing for one tap. It
 * runs thousands of taps in a seeded random order and asserts, after *every
 * single one*, the properties that were violated when the bug was live:
 *
 *   - a tap changes at most one slot
 *   - the only card that may appear is the card that was tapped
 *   - a card never appears twice
 *   - the deck never exceeds its size
 *   - a slot emptied stays empty until something is deliberately put in it
 *
 * That last one is why a deck is a sparse array and not a queue. Compacting on
 * removal slides the next card down, so clearing slots left to right deletes
 * every other card -- which shipped once, and which a fuzz like this catches on
 * roughly the third tap.
 */

import { describe, it, expect } from "vitest";
import * as deckEdit from "../src/core/deckEdit";
import * as cards from "../src/core/cards";
import { config } from "../src/core/config";

/** Seeded, so a failure is reproducible rather than a story about last Tuesday. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const ids = (d: deckEdit.DeckSlots) => d.map((c) => c?.id);

describe("one tap at a time", () => {
  it("adds the tapped card to the first free slot", () => {
    const deck = deckEdit.emptyDeck();
    const r = deckEdit.tapCard(deck, cards.ALL[3]);
    expect(r.did).toBe("added");
    expect(ids(r.deck)[0]).toBe(cards.ALL[3].id);
  });

  it("removes the tapped card wherever it sits", () => {
    let deck = deckEdit.toSlots(cards.ALL.slice(0, config.deckSize));
    const victim = cards.ALL[4];
    const r = deckEdit.tapCard(deck, victim);
    expect(r.did).toBe("removed");
    expect(ids(r.deck)).not.toContain(victim.id);
  });

  it("leaves a hole rather than closing the gap", () => {
    // The compaction bug, pinned. Slot 4 empties; slot 5 must not slide down.
    const deck = deckEdit.toSlots(cards.ALL.slice(0, config.deckSize));
    const after = deckEdit.clearSlot(deck, 4);
    expect(after[4]).toBeUndefined();
    expect(after[5]).toBe(deck[5]);
  });

  it("refuses a full deck out loud, and changes nothing", () => {
    const deck = deckEdit.toSlots(cards.ALL.slice(0, config.deckSize));
    const r = deckEdit.tapCard(deck, cards.ALL[config.deckSize + 1]);
    expect(r.did).toBe("full");
    expect(ids(r.deck)).toEqual(ids(deck));
  });

  it("never mutates the deck it was given", () => {
    const deck = deckEdit.emptyDeck();
    const before = ids(deck);
    deckEdit.tapCard(deck, cards.ALL[0]);
    deckEdit.clearSlot(deckEdit.toSlots(cards.ALL.slice(0, 3)), 1);
    expect(ids(deck)).toEqual(before);
  });
});

describe("hammered: 4000 random taps", () => {
  it("holds every invariant after every single tap", () => {
    const rand = rng(20260811);
    let deck = deckEdit.toSlots(cards.ALL.slice(0, config.deckSize));
    const failures: string[] = [];

    for (let i = 0; i < 4000; i++) {
      const before = deck;
      const beforeIds = ids(before);

      // Mix the two things a player can do: tap a card, or clear a slot.
      let tapped: cards.Card | undefined;
      if (rand() < 0.8) {
        tapped = cards.ALL[Math.floor(rand() * cards.ALL.length)];
        deck = deckEdit.tapCard(before, tapped).deck;
      } else {
        deck = deckEdit.clearSlot(before, Math.floor(rand() * (config.deckSize + 1)));
      }

      const afterIds = ids(deck);
      const live = deckEdit.picked(deck);

      if (live.length > config.deckSize) failures.push(`${i}: oversize ${live.length}`);
      if (new Set(live).size !== live.length) failures.push(`${i}: duplicate ${afterIds}`);

      const appeared = afterIds.filter((x, n) => x && x !== beforeIds[n]).filter(Boolean);
      const added = afterIds.filter((x) => x && !beforeIds.includes(x));
      if (added.length > 1) failures.push(`${i}: ${added.length} cards appeared at once`);
      if (added.length === 1 && added[0] !== tapped?.id) {
        failures.push(`${i}: tapped ${tapped?.id} but ${added[0]} appeared`);
      }
      // At most one slot may differ per action.
      const changedSlots = afterIds.filter((x, n) => x !== beforeIds[n]).length;
      if (changedSlots > 1) failures.push(`${i}: ${changedSlots} slots changed at once`);
      if (appeared.length > 1) failures.push(`${i}: multiple appearances`);

      if (failures.length) break;
    }

    expect(failures).toEqual([]);
  });

  it("a full deck refuses every new card, forever", () => {
    const rand = rng(7);
    const deck = deckEdit.toSlots(cards.ALL.slice(0, config.deckSize));
    for (let i = 0; i < 500; i++) {
      const card = cards.ALL[Math.floor(rand() * cards.ALL.length)];
      const r = deckEdit.tapCard(deck, card);
      if (deckEdit.holds(deck, card)) expect(r.did).toBe("removed");
      else {
        expect(r.did).toBe("full");
        expect(ids(r.deck)).toEqual(ids(deck));
      }
    }
  });

  it("emptying every slot leaves exactly nothing", () => {
    let deck = deckEdit.toSlots(cards.ALL.slice(0, config.deckSize));
    for (let i = 0; i < config.deckSize; i++) deck = deckEdit.clearSlot(deck, i);
    expect(deckEdit.picked(deck)).toHaveLength(0);
    expect(deckEdit.isFull(deck)).toBe(false);
    expect(deck).toHaveLength(config.deckSize); // still slots, not a shrunk array
  });

  it("round-trips: tapping a card twice restores the same cards", () => {
    // The same *cards*, not the same slots -- and the fuzz caught me asserting
    // the stronger thing. Re-adding takes the first free slot, so a card lifted
    // out of slot 1 while slot 0 is empty comes back into slot 0. That is
    // correct: a deck is a set of six with stable positions only while nothing
    // is removed, and the alternative is remembering a card's old slot and
    // reserving it, which is a hole in the deck that cannot be filled.
    const rand = rng(99);
    let deck = deckEdit.toSlots(cards.ALL.slice(0, 3));
    const set = (d: deckEdit.DeckSlots) => deckEdit.picked(d).map((c) => c.id).sort();

    for (let i = 0; i < 400; i++) {
      const card = cards.ALL[Math.floor(rand() * cards.ALL.length)];
      const before = set(deck);
      const once = deckEdit.tapCard(deck, card);
      if (once.did === "full") continue;
      const twice = deckEdit.tapCard(once.deck, card);
      expect(set(twice.deck)).toEqual(before);
      deck = once.deck;
    }
  });

  it("a card never lands in a slot that was already taken", () => {
    const rand = rng(4242);
    let deck = deckEdit.emptyDeck();
    for (let i = 0; i < 1500; i++) {
      const card = cards.ALL[Math.floor(rand() * cards.ALL.length)];
      const r = deckEdit.tapCard(deck, card);
      if (r.did === "added") expect(deck[r.slot]).toBeUndefined();
      if (r.did === "removed") expect(deck[r.slot]).toBe(card);
      deck = r.deck;
    }
  });
});
