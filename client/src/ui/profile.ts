/**
 * Who the player is, as one thing the menu can draw.
 *
 * Three sources have to agree: the account the API knows about, the record
 * kept on this device, and the face that was picked. Any of them can be
 * missing -- a first launch with no network has none -- and the home screen
 * still has to say something true rather than nothing at all, which is what it
 * did before. `savedAccount()` has existed since online play shipped and no
 * screen ever called it.
 *
 * Deliberately not a React hook and not a store. It reads the three sources
 * every time it is asked, because they change from three different places
 * (a match ending, a sign-in, the picker) and a cached copy would be stale in
 * whichever one was not thought about.
 */

import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import { savedAccount } from "../net/identity";
import { loadRecord, forgetRecord, seedRecord } from "./deckStore";
import * as collection from "./collection";

const FACE_KEY = "clashofpokemon.face";

export interface Profile {
  /** What to show. Never blank, even with nothing to go on. */
  name: string;
  /** Is this account only a guest? True when we cannot tell, which is safer. */
  guest: boolean;
  /** Does a server know about this player at all? */
  saved: boolean;
  /** What they log in with. Absent for a guest, who has no way back in. */
  username?: string;
  /** The creature the account wears, as the server has it. */
  avatar?: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  /**
   * Whole percent, or undefined before a first match.
   *
   * Not zero: nought percent is a claim about a player who has lost, and this
   * is a player who has not played. Left as `wins / played` it reaches the
   * screen as NaN%.
   */
  winRate?: number;
  bestStreak: number;
}

/** The name for somebody the API has never met. */
const ANONYMOUS = "New challenger";

export function current(): Profile {
  const account = savedAccount();
  const record = loadRecord();
  const played = record.wins + record.losses + record.draws;

  return {
    name: account?.displayName?.trim() || ANONYMOUS,
    // Absent means we have not signed in yet, and an unknown account is
    // treated as a guest -- the warning that costs nothing if wrong.
    guest: account?.guest ?? true,
    saved: account !== undefined,
    username: account?.username,
    avatar: account?.avatar,
    wins: record.wins,
    losses: record.losses,
    draws: record.draws,
    played,
    winRate: played === 0 ? undefined : Math.round((record.wins / played) * 100),
    bestStreak: record.bestStreak,
  };
}

/**
 * Is this account one clearing a browser would destroy?
 *
 * The red dot on the portrait is this and nothing else. A guest's only proof
 * of ownership is a refresh token in local storage, so there is nothing to
 * recover it with once that is gone.
 */
export function atRisk(me: Profile): boolean {
  return me.guest;
}

/** Every creature that can be worn: the roster a deck is built from. */
export function faces(): readonly Card[] {
  return cards.ALL;
}

export function chosenFace(): string | undefined {
  try {
    return localStorage.getItem(FACE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pick a face, or pass nothing to take it off.
 *
 * Validated here as well as on the server. The picker only offers what
 * `faces()` returns, so a rejection means something else wrote the value --
 * and finding that out now beats finding out when the save bounces.
 */
export function chooseFace(id: string | undefined) {
  if (id !== undefined && !cards.byId(id)) {
    throw new Error(`no such creature to wear: ${id}`);
  }
  try {
    if (id === undefined) localStorage.removeItem(FACE_KEY);
    else localStorage.setItem(FACE_KEY, id);
  } catch {
    // Private browsing refuses writes; the face just does not persist.
  }
}

/**
 * The face to draw, given a deck.
 *
 * Falls back to deck slot one rather than to a fixed default. Slot one is the
 * Mega slot -- the card the player deliberately put there -- so a player who
 * never opens the picker still gets a portrait that means something.
 */
export function faceOf(me: Profile, deck: readonly Card[]): string | undefined {
  // The account's face, once this device has forgotten its own. Signing in
  // clears the local choice deliberately -- it belonged to whoever was here
  // before -- and without this fallback the new player's own face, which the
  // server has, was never read back.
  return chosenFace() ?? me.avatar ?? deck[0]?.id;
}

/**
 * Forget the player this device was being.
 *
 * Called when somebody signs out, and when somebody signs *in* as a different
 * account -- both leave a device carrying a record and a face that belonged to
 * whoever was here before. Signing out and still seeing the last player's win
 * rate is the visible half of that; the invisible half is that their next
 * match would have been added to it.
 *
 * The deck is deliberately left alone. A deck is a thing you built, not a
 * thing you won, and wiping it would make signing out feel like a punishment.
 */
export function forgetLocalPlayer() {
  forgetRecord();
  chooseFace(undefined);
  // Cards, coins and packs are progress, and progress belongs to whoever
  // earned it. Left behind, they hand the next person on this device a
  // collection they never opened a pack for.
  collection.forget();
}

/**
 * Take on the record the account arrived with.
 *
 * The device's tally stays the one the screen reads, so a match that just
 * finished shows immediately -- reading the account's copy instead would
 * freeze the record until a round trip and a refetch. Seeding it at sign-in
 * is what makes the record follow the player to a second device, which is the
 * thing that was actually broken.
 */
export function adoptAccountRecord() {
  const account = savedAccount();
  if (!account) return;
  seedRecord({
    wins: account.wins ?? 0,
    losses: account.losses ?? 0,
    draws: account.draws ?? 0,
  });
}

/** What just happened to who this device is signed in as. */
export type AuthChange = "register" | "login" | "signout";

/**
 * Whether this device's progress survives an account change.
 *
 * One rule, in one place with a name, because the two halves of it look
 * arbitrary side by side and are not:
 *
 *   register  KEEP.  Registering binds a username and a password to the
 *             account already being played. Its record is the entire reason
 *             the schema makes a guest and a registered player the same row --
 *             a guest with two hundred matches signs up and still has two
 *             hundred matches. Clearing here would throw away the thing the
 *             design exists to protect.
 *
 *   login     CLEAR. A different account has arrived on this device. The
 *             record and face here belonged to whoever was on it before.
 *
 *   signout   CLEAR. Same reason, in the other direction: the next person to
 *             pick this device up must not inherit a win rate, and the next
 *             match must not be added to it.
 *
 * It lived inside the profile screen as two branches of a ternary, which is
 * exactly where somebody eventually makes them symmetrical "for consistency".
 */
export function afterAuth(kind: AuthChange) {
  if (kind === "register") return;
  forgetLocalPlayer();
  // Signing in brings a record with it; signing out brings nothing, and
  // `adoptAccountRecord` does nothing without an account.
  if (kind === "login") adoptAccountRecord();
}
