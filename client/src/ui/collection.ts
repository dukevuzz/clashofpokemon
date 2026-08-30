/**
 * What this player owns, and what they can spend.
 *
 * On the device, for now. The server has no collection yet, so this is the
 * honest shape of a local trial rather than a pretence at one: the numbers are
 * real, the rules are the ones the real thing will use, and none of it
 * survives a cleared browser. When the server grows a collection this file is
 * the seam -- the screens above it never touch storage directly.
 *
 * One currency. Coins come from playing and from cards you already had, and
 * both buy the same thing; a second resource is one more than a pack screen
 * can explain.
 */

import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import * as packs from "../core/packs";
import type { Settlement } from "../core/packs";

const KEY = "clashofpokemon.collection";

/** What a pack costs, when you are buying rather than winning one. */
export const PACK_PRICE = 120;

/**
 * What a finished match pays.
 *
 * Losing pays too, and that is the important one. If only winning earns, a
 * bad session earns nothing, and a bad session is exactly when somebody
 * decides to stop. A loss is worth less than a win by enough to matter and
 * more than nothing by enough to keep the evening moving.
 *
 * Four wins buys a pack at 120. That is the number that decides whether any
 * of this is worth doing: a pack has to be a handful of matches, not a grind.
 */
export const COINS_PER = { win: 30, draw: 18, loss: 12 } as const;

/**
 * A pack for turning up, every few matches, whatever the results.
 *
 * The second of the two sources. Coins reward playing well; this rewards
 * playing at all, so progress never depends entirely on a balance.
 */
export const MATCHES_PER_PACK = 5;

interface Stored {
  /** Card ids. A set on the way out, an array on the way in. */
  owned: string[];
  /**
   * Which of those ids were pulled shiny.
   *
   * A subset of `owned` by construction -- a shiny pull adds to both -- but
   * stored as its own array rather than inferred, because "is this id
   * shiny" is a question the deck editor and every portrait on the roster
   * need an O(1) answer to, not a question worth deriving from the pull
   * history every time it is asked.
   *
   * Added after `owned` shipped, so any save from before this field existed
   * simply has none of it -- `read()` treats that the same as an empty
   * array rather than as a corrupt one.
   */
  shiny: string[];
  /**
   * Every (creature, face, finish) actually held, as whole keys.
   *
   * `owned` and `shiny` answer "do I have this card at all", which the deck
   * editor and the roster grid want. This answers "which of its faces", which
   * is the collection screen's question, and the two are not the same -- you
   * can own six faces of one creature.
   */
  variants: string[];
  /**
   * Shards held, per creature id.
   *
   * Not one global pot: a shard is a claim on ONE creature's faces. That is
   * what stops a duplicate being a consolation prize -- it is progress toward
   * something specific, and which something is decided by what you actually
   * pulled rather than by what you would have chosen.
   */
  shards: Record<string, number>;
  coins: number;
  /** Unopened packs. The count is the permission to open one. */
  packs: number;
  /** Matches since the last free pack. Never reset by anything else. */
  since: number;
}

const EMPTY: Stored = { owned: [], shiny: [], variants: [], shards: {}, coins: 0, packs: 0, since: 0 };

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const got = JSON.parse(raw) as Partial<Stored>;
    return {
      owned: Array.isArray(got.owned) ? got.owned.filter((id) => typeof id === "string") : [],
      // Absent on any save written before shininess existed, and malformed
      // is no better than absent -- either way an empty collection of
      // shinies is the honest answer, not a thrown error.
      shiny: Array.isArray(got.shiny) ? got.shiny.filter((id) => typeof id === "string") : [],
      variants: Array.isArray(got.variants)
        ? got.variants.filter((k) => typeof k === "string") : [],
      shards: got.shards && typeof got.shards === "object"
        ? Object.fromEntries(
            Object.entries(got.shards).filter(
              ([, n]) => typeof n === "number" && n >= 0))
        : {},
      coins: typeof got.coins === "number" && got.coins >= 0 ? got.coins : 0,
      packs: typeof got.packs === "number" && got.packs >= 0 ? got.packs : 0,
      since: typeof got.since === "number" && got.since >= 0 ? got.since : 0,
    };
  } catch {
    // Unreadable store: an empty collection beats refusing to launch.
    return { ...EMPTY };
  }
}

function write(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private browsing refuses writes. The pack was still opened; it just
    // does not survive the tab.
  }
}

export function owned(): ReadonlySet<string> {
  return new Set(read().owned);
}

/** Which owned ids are held as shiny. Not every card here is shiny -- most owners of most cards are not. */
export function shinyOwned(): ReadonlySet<string> {
  return new Set(read().shiny);
}

/** Is this particular card held as shiny? What a portrait asks before deciding which frame to draw. */
export function isShiny(id: string): boolean {
  return read().shiny.includes(id);
}

export function coins(): number {
  return read().coins;
}

export function packsHeld(): number {
  return read().packs;
}

export function addCoins(n: number) {
  const s = read();
  s.coins += Math.max(0, Math.round(n));
  write(s);
}

/** A pack won rather than bought. */
export function grantPack(n = 1) {
  const s = read();
  s.packs += Math.max(0, Math.round(n));
  write(s);
}

/** Trade coins for a pack. False when there are not enough, and nothing moves. */
export function buyPack(): boolean {
  const s = read();
  if (s.coins < PACK_PRICE) return false;
  s.coins -= PACK_PRICE;
  s.packs += 1;
  write(s);
  return true;
}

/**
 * Open one, if there is one.
 *
 * Returns what the pack turned out to be, or undefined when there was no pack
 * to open -- the held count is the permission, so a screen cannot conjure one
 * by calling this twice.
 *
 * `contents` exists for tests and for a future server that decides the pull
 * itself; nothing in the game passes it.
 */
export function openPack(
  rng: () => number = Math.random,
  contents?: readonly Card[],
): Settlement | undefined {
  const s = read();
  if (s.packs < 1) return undefined;

  const pulled = contents ?? packs.open(rng);
  // A shiny you do not own is new even when the plain card has been owned
  // for weeks -- `ownershipKeys` is what keeps those two ownership
  // questions from collapsing into one.
  const keys = packs.ownershipKeys(new Set(s.owned), new Set(s.shiny), new Set(s.variants));
  const settled = packs.settle(pulled, keys);

  s.packs -= 1;
  // Duplicates pay shards, not coins. Coins are what a MATCH pays, and keeping
  // the two sources separate is what makes them mean different things: coins
  // buy another chest, shards buy one specific face of one specific creature.
  for (const [id, n] of Object.entries(settled.shards)) {
    s.shards[id] = (s.shards[id] ?? 0) + n;
  }
  s.owned = [...new Set([...s.owned, ...settled.fresh.map((c) => c.id)])];
  s.shiny = [...new Set([
    ...s.shiny, ...settled.fresh.filter((c) => c.shiny).map((c) => c.id),
  ])];
  s.variants = [...new Set([
    ...s.variants, ...settled.fresh.map((c) => packs.variantKey(c)),
  ])];
  write(s);
  return settled;
}

/** What a finished match was worth. */
export interface Reward {
  coins: number;
  /** Whether this match was the one that earned a pack. */
  pack: boolean;
  /** Matches still to play before the next free pack. */
  toNextPack: number;
}

/**
 * Pay for a finished match.
 *
 * Called once per result, from wherever the result is known. Deliberately
 * returns what it paid rather than being silent: a reward the player is not
 * told about may as well not have happened.
 */
export function reward(result: "win" | "loss" | "draw"): Reward {
  const s = read();
  const coins = COINS_PER[result];
  s.coins += coins;

  // Counts up and rolls over, rather than resetting: a player who earns a
  // pack on match five starts match six one closer to the next, not back at
  // the beginning.
  s.since += 1;
  const pack = s.since >= MATCHES_PER_PACK;
  if (pack) {
    s.since -= MATCHES_PER_PACK;
    s.packs += 1;
  }
  write(s);
  return { coins, pack, toNextPack: MATCHES_PER_PACK - s.since };
}

/** How many matches until the next free pack. */
export function toNextPack(): number {
  return MATCHES_PER_PACK - read().since;
}

/** How much of the roster has been seen. */
export function progress(): { have: number; total: number } {
  const have = read().owned.filter((id) => cards.byId(id)).length;
  return { have, total: cards.ALL.length };
}

/** Forget it all, alongside the rest of a device's player. */
export function forget() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was stored to forget.
  }
}


/** Every (creature, face, finish) held, as whole keys. */
export function variantsOwned(): ReadonlySet<string> {
  return new Set(read().variants);
}


/** Shards held for one creature. */
export function shardsFor(id: string): number {
  return read().shards[id] ?? 0;
}

/** Every creature you hold shards for. */
export function allShards(): Readonly<Record<string, number>> {
  return { ...read().shards };
}

/**
 * Buy one face outright.
 *
 * Returns false and moves nothing when it is unaffordable or already held, so
 * a double-tap cannot spend twice. The variant key is built the same way
 * `packs.variantKey` builds it -- if those two ever disagree, a bought face
 * would be invisible to the collection that just paid for it.
 */
export function buyFace(id: string, emotion: number, shiny: boolean): boolean {
  const s = read();
  const suffix = emotion === 0 ? "" : `#e${emotion}`;
  const key = `${id}${suffix}${shiny ? "#shiny" : ""}`;
  if (s.variants.includes(key)) return false;

  const cost = packs.faceCost(emotion, shiny);
  if ((s.shards[id] ?? 0) < cost) return false;

  s.shards[id] = (s.shards[id] ?? 0) - cost;
  s.variants = [...s.variants, key];
  if (!s.owned.includes(id)) s.owned = [...s.owned, id];
  if (shiny && !s.shiny.includes(id)) s.shiny = [...s.shiny, id];
  write(s);
  return true;
}
