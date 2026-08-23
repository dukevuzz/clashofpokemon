/** The rules of building a deck, with nothing drawn. */

import type { Card } from "./cards";
import { config } from "./config";

/** A deck being edited: `deckSize` slots, any of which may be empty. */
export type DeckSlots = readonly (Card | undefined)[];

/** A deck of the right length, with every slot empty. */
export function emptyDeck(size: number = config.deckSize): DeckSlots {
  return Array.from({ length: size }, () => undefined);
}

/** Pad or trim a loaded deck to the fixed slot count. */
export function toSlots(cards: readonly Card[], size: number = config.deckSize): DeckSlots {
  return Array.from({ length: size }, (_, i) => cards[i]);
}

/** The cards actually chosen, in slot order, gaps dropped. */
export function picked(deck: DeckSlots): Card[] {
  return deck.filter((c): c is Card => Boolean(c));
}

/** The first empty slot, or -1 when there is none. */
export function freeSlot(deck: DeckSlots): number {
  return deck.findIndex((c) => !c);
}

/** Whether the deck may be played. A short deck is a deck mid-edit. */
export function isFull(deck: DeckSlots): boolean {
  return picked(deck).length >= config.deckSize;
}

/** Whether this exact card is already in the deck. */
export function holds(deck: DeckSlots, card: Card): boolean {
  return deck.includes(card);
}

/** What a tap on a card in the collection does. */
export type TapResult =
  | { deck: DeckSlots; did: "added"; slot: number }
  | { deck: DeckSlots; did: "removed"; slot: number }
  | { deck: DeckSlots; did: "full" };

/** Toggle a card by identity, never by position. */
export function tapCard(deck: DeckSlots, card: Card): TapResult {
  const at = deck.indexOf(card);
  if (at >= 0) {
    const next = [...deck];
    next[at] = undefined;
    return { deck: next, did: "removed", slot: at };
  }
  const free = freeSlot(deck);
  if (free < 0) return { deck, did: "full" };
  const next = [...deck];
  next[free] = card;
  return { deck: next, did: "added", slot: free };
}

/** Empty one slot, leaving a hole. Out-of-range and empty slots are no-ops. */
export function clearSlot(deck: DeckSlots, slot: number): DeckSlots {
  if (slot < 0 || slot >= deck.length || !deck[slot]) return deck;
  const next = [...deck];
  next[slot] = undefined;
  return next;
}

/** Take everything out. Kept here so "clear" means one thing everywhere. */
export function clearAll(deck: DeckSlots): DeckSlots {
  return emptyDeck(deck.length);
}

/**
 * Move a card from one slot to another, shuffling what is in between.
 *
 * Slot one is the Mega slot, so the order of a deck is now a decision rather
 * than the order you happened to tap cards in. Reordering has to be possible
 * without emptying and refilling.
 *
 * An insert-and-shift rather than a swap: dragging a card three slots left and
 * having it trade places with whatever sat there scrambles the rest of the row,
 * where shifting keeps every other card in the order the player put it.
 */
export function moveSlot(deck: DeckSlots, from: number, to: number): DeckSlots {
  if (from === to) return deck;
  if (from < 0 || to < 0 || from >= deck.length || to >= deck.length) return deck;
  const out = [...deck];
  const [card] = out.splice(from, 1);
  out.splice(to, 0, card);
  return out;
}
