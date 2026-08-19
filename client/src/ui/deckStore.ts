/** The chosen deck, remembered between sessions. */

import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import { config } from "../core/config";

import { DEFAULT_TROOP, TROOPS } from "../core/towerTroops";
import { branchesFor } from "../core/evolution";

const KEY = "clashofpokemon.deck";
const BRANCH_KEY = "clashofpokemon.branch";

/** The saved deck, exactly as it was left. */
export function loadDeck(): Card[] {
  let deck: Card[] = [];
  // Absent is not the same as empty. `getItem` returns null when the key has
  // never been written and "[]" when a player cleared every slot -- and
  // treating both as "no deck" handed six cards back to someone who had just
  // removed all six. Only the first is a new player.
  let saved = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const ids = JSON.parse(raw) as string[];
      // After the parse, not before: unreadable is not the same as empty
      // either, and a corrupt store should still launch into a playable deck.
      saved = true;
      // Unknown ids are dropped rather than trusted -- a card can be removed
      // from the roster between sessions.
      deck = ids
        .map((id) => cards.byId(id))
        .filter((c): c is Card => Boolean(c))
        .filter((c, i, all) => all.indexOf(c) === i);
    }
  } catch {
    // A corrupt or unavailable store is not worth failing a launch over.
  }
  // Only a player who has never saved anything gets cards chosen for them.
  if (!saved) return starterDeck();
  return deck.slice(0, config.deckSize);
}

/** Whether a deck may be played. A short deck is a deck mid-edit. */
export function deckIsFull(deck: Card[]): boolean {
  return deck.length >= config.deckSize;
}

/** The deck a new player starts with. */
export function starterDeck(): Card[] {
  const pool = cards.ALL;
  const out: Card[] = [];
  for (let i = 0; i < config.deckSize; i++) {
    const idx = Math.round((i * (pool.length - 1)) / (config.deckSize - 1));
    if (!out.includes(pool[idx])) out.push(pool[idx]);
  }
  // Spacing can collide where several cards share a cost; top up from the middle.
  for (const c of pool) {
    if (out.length >= config.deckSize) break;
    if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, config.deckSize);
}

export function saveDeck(deck: Card[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(deck.map((c) => c.id)));
  } catch {
    // Private browsing refuses writes; the deck just does not persist.
  }
}

/** The Eevee branch committed in the deck builder, if any. */
export function loadBranch(): string | undefined {
  try {
    const id = localStorage.getItem(BRANCH_KEY);
    // Validated, not trusted. Everything read back out of storage is a value
    // from a previous version of the roster, and a branch that no longer exists
    // silently never matches the offer -- so the game would keep asking you to
    // choose after you had chosen. `loadDeck` has always checked its ids; these
    // two did not, which is the same hole in two more places.
    if (!id) return undefined;
    return branchesFor("eevee")?.includes(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function saveBranch(id: string | undefined) {
  try {
    if (id) localStorage.setItem(BRANCH_KEY, id);
    else localStorage.removeItem(BRANCH_KEY);
  } catch {
    // Private browsing refuses writes; the choice just does not persist.
  }
}

// ------------------------------------------------------------- tower troop

const TROOP_KEY = "clashofpokemon.troop";

/** Which creature sits on your lane towers. */
export function loadTroop(): string {
  try {
    const id = localStorage.getItem(TROOP_KEY);
    // `troopById` falls back to the first troop for an unknown id, silently. So
    // a stale id did not crash -- it did something worse, and highlighted
    // nothing in the menu while the match used a troop you never picked.
    if (id && TROOPS.some((t) => t.id === id)) return id;
    return DEFAULT_TROOP;
  } catch {
    return DEFAULT_TROOP;
  }
}

export function saveTroop(id: string) {
  try {
    localStorage.setItem(TROOP_KEY, id);
  } catch {
    // Private browsing refuses writes; the choice just does not persist.
  }
}

// ------------------------------------------------------------------- record
//
// A running tally, so the home screen has something that accumulates between
// matches. Without it the dashboard is a launcher; with it, playing has a
// point beyond the match you are in.

const RECORD_KEY = "clashofpokemon.record";
const SETTINGS_KEY = "clashofpokemon.settings";

export interface Record { wins: number; losses: number; draws: number }

export function loadRecord(): Record {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<Record>;
      return { wins: r.wins ?? 0, losses: r.losses ?? 0, draws: r.draws ?? 0 };
    }
  } catch {
    // Unreadable store: start from zero rather than fail a launch.
  }
  return { wins: 0, losses: 0, draws: 0 };
}

export function recordResult(result: "player" | "enemy" | "draw") {
  const r = loadRecord();
  if (result === "player") r.wins += 1;
  else if (result === "enemy") r.losses += 1;
  else r.draws += 1;
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(r));
  } catch {
    // Private browsing refuses writes; the record just does not persist.
  }
}

export interface Settings {
  /** Show the opponent's elixir. */
  showEnemyElixir: boolean;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { showEnemyElixir: false, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // fall through
  }
  return { showEnemyElixir: false };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // not persisted; the session still honours it
  }
}
