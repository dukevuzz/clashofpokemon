/**
 * What a deck screen is editing.
 *
 * The screen was written against `cards.ALL` and the lane deck's storage,
 * hardcoded in three places. The arena needs the same screen over a different
 * roster and a different key, and forking it would have left two copies of
 * drag-to-reorder, filtering and slot logic to drift apart.
 *
 * So the roster and its storage became a parameter. The arena is a different
 * value, not a different screen.
 */

import type { Card } from "../core/cards";
import * as cards from "../core/cards";
import { ARENA_ALL } from "../core/arenaRoster";
import {
  loadDeck, saveDeck, starterDeck,
  loadArenaDeck, saveArenaDeck, starterArenaDeck,
} from "./deckStore";

export interface DeckSource {
  /** What the heading calls this deck. */
  title: string;
  /** Everything that may be put in it. */
  roster: readonly Card[];
  load: () => Card[];
  save: (deck: Card[]) => void;
  starter: () => Card[];
  /**
   * Whether to offer the Eevee branch picker.
   *
   * The lane has to ask: Eevee evolves mid-match and a real-time match cannot
   * stop to pose a question. The arena never evolves anything -- Vaporeon is
   * its own entry in the roster -- so the question does not exist there.
   */
  branches: boolean;
  /**
   * Whether elixir means anything here.
   *
   * The lane is an elixir economy and the average cost of a deck is the single
   * most useful number on the screen. The arena charges nothing, so printing
   * an average there would be a figure that describes no rule.
   */
  costs: boolean;
}

export const LANE_SOURCE: DeckSource = {
  title: "Deck",
  roster: cards.ALL,
  load: loadDeck,
  save: saveDeck,
  starter: starterDeck,
  branches: true,
  costs: true,
};

export const ARENA_SOURCE: DeckSource = {
  title: "Arena team",
  roster: ARENA_ALL,
  load: loadArenaDeck,
  save: saveArenaDeck,
  starter: starterArenaDeck,
  branches: false,
  costs: false,
};
