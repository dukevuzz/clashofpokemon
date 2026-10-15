/** The chosen deck, remembered between sessions. */

import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import { config } from "../core/config";

import { DEFAULT_TROOP, TROOPS } from "../core/towerTroops";
import { branchesFor } from "../core/evolution";
import { ARENA_ALL, arenaById } from "../core/arenaRoster";

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
  let savedCount = 0;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const ids = JSON.parse(raw) as string[];
      // After the parse, not before: unreadable is not the same as empty
      // either, and a corrupt store should still launch into a playable deck.
      saved = true;
      savedCount = Array.isArray(ids) ? ids.length : 0;
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

  // Saved ids that all resolve to nothing means the roster changed, not that
  // the player emptied their deck. Only distinguishable here.
  if (savedCount > 0 && deck.length === 0) return starterDeck();

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

// -------------------------------------------------------------- arena team
//
// Two modes, two rosters, two stored decks -- the same split Clash Royale
// makes, for the same reason. A lane deck is six cards priced for an elixir
// economy; an arena team is six creatures picked outright from everything we
// can draw. Sharing one key would mean editing one silently rewrote the other.

const ARENA_KEY = "clashofpokemon.arenaDeck";

/**
 * The saved arena team.
 *
 * Deliberately the same shape as `loadDeck`, including the distinction that
 * cost the lane deck two separate bugs: a key that was never written is a new
 * player and gets a team chosen for them, a key holding "[]" is somebody who
 * emptied it on purpose and gets nothing back.
 */
export function loadArenaDeck(): Card[] {
  let team: Card[] = [];
  let saved = false;
  let savedCount = 0;
  try {
    const raw = localStorage.getItem(ARENA_KEY);
    if (raw !== null) {
      const ids = JSON.parse(raw) as string[];
      saved = true;
      savedCount = Array.isArray(ids) ? ids.length : 0;
      // Validated against the arena roster, not the lane one: these are
      // different sets, and an id saved by an older version may have gone.
      team = (Array.isArray(ids) ? ids : [])
        .map((id) => arenaById(id))
        .filter((c): c is Card => Boolean(c))
        .filter((c, i, all) => all.indexOf(c) === i);
    }
  } catch {
    // A corrupt or unavailable store is not worth failing a launch over.
  }
  if (!saved) return starterArenaDeck();
  if (savedCount > 0 && team.length === 0) return starterArenaDeck();
  return team.slice(0, config.deckSize);
}

export function saveArenaDeck(team: Card[]) {
  try {
    localStorage.setItem(
      ARENA_KEY,
      JSON.stringify(team.slice(0, config.deckSize).map((c) => c.id)),
    );
  } catch {
    // Private browsing refuses writes; the team just does not persist.
  }
}

/**
 * Six recognisable final forms.
 *
 * Final forms rather than a spread across the roster: a stage-1 wins about 2%
 * of bouts against a stage-3, because `tiers.skillDamage` indexes damage by
 * stage. Handing a new player a team of babies would be a tutorial they lose.
 *
 * Named rather than derived so the first thing anyone sees is a team they
 * recognise, then topped up from the roster if a sheet ever goes away.
 */
export function starterArenaDeck(): Card[] {
  const wanted = ["charizard", "blastoise", "venusaur",
                  "gengar", "alakazam", "gyarados"];
  const out: Card[] = [];
  for (const id of wanted) {
    const card = arenaById(id);
    if (card && !out.includes(card)) out.push(card);
  }
  // Only reached if one of the six has lost its sheet. Evolved forms only,
  // for the reason above.
  for (const card of ARENA_ALL) {
    if (out.length >= config.deckSize) break;
    if (card.stage >= 2 && !out.includes(card)) out.push(card);
  }
  return out.slice(0, config.deckSize);
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

export interface Record {
  wins: number;
  losses: number;
  draws: number;
  /** Consecutive wins right now. A loss or a draw ends it. */
  streak: number;
  /** The longest run of wins this device has seen. */
  bestStreak: number;
}

export function loadRecord(): Record {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<Record>;
      // Defaulted one field at a time rather than spread over a template:
      // every record already on a live device predates the streak fields and
      // has to keep its wins.
      return {
        wins: r.wins ?? 0, losses: r.losses ?? 0, draws: r.draws ?? 0,
        streak: r.streak ?? 0, bestStreak: r.bestStreak ?? 0,
      };
    }
  } catch {
    // Unreadable store: start from zero rather than fail a launch.
  }
  return { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 };
}

export function recordResult(result: "player" | "enemy" | "draw") {
  const r = loadRecord();
  if (result === "player") r.wins += 1;
  else if (result === "enemy") r.losses += 1;
  else r.draws += 1;

  // A draw ends a streak. It is not a loss, but it is certainly not a win,
  // and a "streak" that survives one is not a run of wins.
  r.streak = result === "player" ? r.streak + 1 : 0;
  r.bestStreak = Math.max(r.bestStreak, r.streak);

  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(r));
  } catch {
    // Private browsing refuses writes; the record just does not persist.
  }
}

/**
 * Forget this device's record.
 *
 * The record is kept here rather than on the account because offline matches
 * are never reported anywhere -- the server only counts online results. That
 * makes it a property of the device, and a device's record has to stop when
 * the player using it does.
 */
export function forgetRecord() {
  try {
    localStorage.removeItem(RECORD_KEY);
  } catch {
    // Private browsing refuses writes; there was nothing stored to forget.
  }
}

/**
 * Replace the record wholesale, with what an account arrived carrying.
 *
 * Streaks are not seeded: they are a property of a sitting, and inheriting
 * "best streak 9" from another device on the first match here would be a
 * number the player cannot connect to anything they did.
 */
export function seedRecord(r: { wins: number; losses: number; draws: number }) {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(
      { ...r, streak: 0, bestStreak: 0 }));
  } catch {
    // Private browsing refuses writes; the record just stays empty.
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
