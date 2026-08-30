/**
 * What is in a pack.
 *
 * Six cards, because that is a deck's worth -- a pack reads as "a deck you did
 * not build" rather than an arbitrary handful. The last one is always a card
 * worth ending on, which is PAC's rule and the reason their boosters feel
 * generous when the odds are not.
 *
 * Pure, and takes its generator: the same seed gives the same pack, so a
 * complaint about a pull can be reproduced and a bad distribution can be
 * measured rather than argued about.
 */

import * as cards from "./cards";
import type { Card } from "./cards";
// Read directly rather than through `ui/portraits`: nothing in `core/`
// imports Phaser, touches the DOM, or draws anything, and `ui/portraits.ts`
// does all three. The JSON itself is neutral data both layers are allowed
// to read.
import portraitsJson from "../data/portraits.json";
import emotionsJson from "../data/emotions.json";

export const PACK_SIZE = 6;

/**
 * Weight per CARD, not per rarity tier.
 *
 * This is the trap the numbers have to avoid, and it is specific to our
 * roster. PAC weights whole tiers -- legendary 6%, ultra 4% -- which works
 * where rarer tiers hold fewer cards. Ours are the other way round: there are
 * 30 legendaries and 3 ultras. A flat 4% spread across 3 ultras would make
 * any given ultra roughly twice as likely to turn up as any given common,
 * which is precisely backwards.
 *
 * Weighting each card and letting the tier totals fall out keeps "rarer means
 * less likely" true whatever the roster does next.
 */
export const PER_CARD_WEIGHT: Readonly<Record<string, number>> = {
  common: 100,
  uncommon: 60,
  rare: 40,
  // From `epic` down these are solved, not chosen. Every tier below is also
  // in the guaranteed last slot, which lifts it, and a hand-picked ladder
  // kept inverting once that lift was included -- epic and hatch came out
  // fractionally commoner per card than rare. These are the weights at which
  // each tier is at most four fifths as likely as the one above it, after
  // the guarantee.
  epic: 12,
  hatch: 10,
  special: 8,
  ultra: 6,
  unique: 5,
  legendary: 1,
};

/**
 * What the last card of a pack is drawn from: epic or better.
 *
 * Not "unique or legendary", which was the first attempt and measured badly.
 * Our roster is top-heavy -- 21 uniques and 30 legendaries out of 151 -- so
 * guaranteeing the top two tiers put a legendary in 40% of packs and made a
 * unique turn up more often per card than an epic. A guarantee that inverts
 * the rarity ladder teaches players the labels are decoration.
 *
 * Spreading the guarantee across six tiers keeps the promise -- every pack
 * still ends on something you would keep -- while leaving the ladder intact.
 */
export const HEADLINE_RARITIES: readonly string[] = [
  "epic", "hatch", "special", "ultra", "unique", "legendary",
];

/**
 * What a duplicate is worth.
 *
 * A single currency rather than a separate dust: coins come from playing and
 * from cards you already had, and both buy the same thing. Two resources on
 * this screen is one more than the screen can explain.
 */
const COINS: Readonly<Record<string, number>> = {
  common: 5,
  uncommon: 8,
  rare: 12,
  epic: 20,
  hatch: 20,
  special: 25,
  ultra: 40,
  unique: 60,
  legendary: 100,
};

export function coinsFor(rarity: string): number {
  return COINS[rarity] ?? COINS.common;
}

const weightOf = (c: Card) => PER_CARD_WEIGHT[c.rarity] ?? 1;

/** One weighted draw from `pool`, which the caller has already filtered. */
function draw(pool: readonly Card[], rng: () => number): Card | undefined {
  const total = pool.reduce((a, c) => a + weightOf(c), 0);
  if (total <= 0) return pool[0];
  let roll = rng() * total;
  for (const c of pool) {
    roll -= weightOf(c);
    if (roll <= 0) return c;
  }
  // Floating point can leave a sliver; the last card is the honest answer.
  return pool[pool.length - 1];
}

/** Shiny frames on the sheet, once the export tool has put any there. Absent until then. */
const SHINY_FRAMES = (portraitsJson as { shiny?: Record<string, number> }).shiny;

/** A species with no shiny art cannot roll one -- a flag with nothing to show for it. */
function canBeShiny(sheet: string): boolean {
  return SHINY_FRAMES?.[sheet] !== undefined;
}

/**
 * Roughly one card in twenty, and only where there is shiny art to show for
 * it. Fixed rather than tunable per rarity: a rarer card being shinier too
 * would be a second rarity ladder stacked on the first, and this roster's
 * first ladder already does the "rarer means less likely" job on its own.
 */
export const SHINY_CHANCE = 0.05;

const EMOTION_DATA = emotionsJson as {
  emotions: string[];
  creatures: Record<string, { n: number[]; s: number[] }>;
};

/**
 * What each face costs, by its index in the canonical order.
 *
 * Lifted from pokemonAutoChess: 50 for the default face, then 100, 150 and 200
 * as the ladder climbs. Shiny multiplies by three there; that only matters once
 * faces are bought rather than pulled, so it lives with the shop when there is
 * one.
 */
/**
 * What a duplicate is worth in that creature's shards.
 *
 * pokemonAutoChess's numbers, and the ratio is the point: a repeated shiny is
 * worth five ordinary ones. Both are deliberately below the cost of any face,
 * so no single duplicate buys anything -- you always need a few, which is what
 * keeps a chest worth opening after the roster is complete.
 */
export const SHARDS_PER_DUPLICATE = 50;
export const SHARDS_PER_SHINY_DUPLICATE = 250;

export function shardsFor(card: Card): number {
  return card.shiny ? SHARDS_PER_SHINY_DUPLICATE : SHARDS_PER_DUPLICATE;
}

/**
 * What a face costs to buy outright, in that creature's shards.
 *
 * Shiny triples, as upstream. The ladder is the same array the pull odds are
 * weighted by, so price and rarity cannot drift apart.
 */
export function faceCost(emotion: number, shiny: boolean): number {
  const base = EMOTION_COST[emotion] ?? EMOTION_COST[0];
  return shiny ? base * 3 : base;
}

export const EMOTION_COST: readonly number[] = [
  50,
  100, 100, 100, 100, 100, 100,
  150, 150, 150, 150, 150, 150, 150,
  200, 200, 200, 200, 200, 200,
];

/**
 * One card's shiny roll.
 *
 * Pure and rng-driven, like the rest of this file: the same card and the
 * same generator state give the same answer, so a pack can be replayed and a
 * shiny pull is exactly as reproducible as everything else in it. Exported
 * on its own because a single pull is what the tests -- and the eventual
 * "reroll one card" feature nobody has asked for yet -- want to drive
 * directly, without going through a whole pack for one flag.
 */
export function withShinyRoll(card: Card, rng: () => number): Card {
  if (!canBeShiny(card.sheet)) return card;
  return rng() < SHINY_CHANCE ? { ...card, shiny: true } : card;
}

/**
 * What faces this creature has art for, in the variant the card was pulled as.
 *
 * Coverage is uneven upstream -- some creatures have all twenty emotions, some
 * only a handful -- so the pool is read per creature rather than assumed.
 */
function facesFor(sheet: string, shiny: boolean): number[] {
  const c = EMOTION_DATA.creatures[sheet];
  if (!c) return [];
  return shiny ? c.s : c.n;
}

/**
 * Which face a pull wears.
 *
 * Weighted by `1 / cost`, which is pokemonAutoChess's rule and worth keeping:
 * it means the shop price and the pull odds are the same ranking expressed
 * twice, so nothing has to be tuned to agree. A common face is cheap AND
 * likely; an expensive one is rare AND dear. Get the order right once and both
 * follow.
 */
export function withEmotionRoll(card: Card, rng: () => number): Card {
  const faces = facesFor(card.sheet, card.shiny === true);
  // Nothing to choose between: the creature has no emotion sheet, or only its
  // default face. Leaving `emotion` unset keeps it rendering from the shared
  // portrait sheet rather than a per-creature one that may not exist.
  if (faces.length < 2) return card;

  const weights = faces.map((e) => 1 / EMOTION_COST[e]);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < faces.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return { ...card, emotion: faces[i] };
  }
  return { ...card, emotion: faces[faces.length - 1] };
}

/**
 * Open one pack.
 *
 * Without replacement: two of a card in a single pack is one card and some
 * coins wearing a costume, and it reads as the game being broken rather than
 * as luck.
 */
export function open(rng: () => number = Math.random): Card[] {
  const taken = new Set<string>();
  const out: Card[] = [];

  const available = () => cards.ALL.filter((c) => !taken.has(c.id));

  for (let i = 0; i < PACK_SIZE - 1; i++) {
    const card = draw(available(), rng);
    if (!card) break;
    taken.add(card.id);
    out.push(withEmotionRoll(withShinyRoll(card, rng), rng));
  }

  // The card the pack ends on. Weighted within the headline rarities too, so
  // a legendary is still rarer than a unique.
  const headline = available().filter((c) => HEADLINE_RARITIES.includes(c.rarity));
  const last = draw(headline.length ? headline : available(), rng);
  if (last) {
    taken.add(last.id);
    out.push(withEmotionRoll(withShinyRoll(last, rng), rng));
  }
  return out;
}

/** What a pack turned out to be worth, given what was already owned. */
export interface Settlement {
  /**
   * The pack in the order it was dealt.
   *
   * Carried through because splitting into new and repeated destroys it, and
   * the order is load-bearing: the reveal turns cards over left to right and
   * the last one is the guaranteed card. Rebuilding it from `fresh` and
   * `duplicates` puts every repeat at the end.
   */
  pulled: Card[];
  /** Cards this account did not have. */
  fresh: Card[];
  /** Cards it did, which pay shards instead. */
  duplicates: Card[];
  coins: number;
  /**
   * Shards earned, per creature id.
   *
   * Per creature rather than global on purpose: a shard is a claim on ONE
   * creature's faces, so pulling a second Charmander moves you toward a
   * Charmander emotion and nothing else. That is what makes a duplicate feel
   * like progress instead of a consolation coin -- you are always working
   * toward something specific, chosen by what the chest happened to give you.
   */
  shards: Record<string, number>;
}

/**
 * The key `settle` and `ownershipKeys` compare by.
 *
 * A shiny and its plain card are two different things to own -- a shiny you
 * do not have is new even when the plain version has been owned for weeks --
 * so they cannot share a key. Everything that is not shiny keeps the plain
 * card id, unchanged, so a caller that never touches shininess sees no
 * difference at all.
 */
function keyFor(card: Card): string {
  // Face and finish both count: the same creature in two emotions is two
  // things to own, which is the whole point of collecting them. The default
  // face keeps the bare id so every collection saved before emotions existed
  // still reads correctly.
  const face = card.emotion && card.emotion !== 0 ? `#e${card.emotion}` : "";
  return card.shiny ? `${card.id}${face}#shiny` : `${card.id}${face}`;
}

/**
 * Turns "which ids are owned" and "which of those are owned as shiny" into
 * the single key set `settle` compares pulls against.
 *
 * A separate function rather than folding this into `settle` because the two
 * ownership sets are how the collection is actually stored (`Stored.owned`,
 * `Stored.shiny` in `ui/collection.ts`), and re-deriving that shape inside
 * `settle` on every call would make the one function do two jobs.
 */
export function ownershipKeys(
  owned: ReadonlySet<string>,
  shinyOwned: ReadonlySet<string>,
  variants: ReadonlySet<string> = new Set(),
): Set<string> {
  // `variants` already holds whole keys (`id`, `id#e7`, `id#e7#shiny`). The
  // other two are the pre-emotion shape and are folded in so a collection
  // saved before faces existed keeps every card it had.
  return new Set([
    ...owned,
    ...[...shinyOwned].map((id) => `${id}#shiny`),
    ...variants,
  ]);
}

/** The key a card is stored under. Exported so the collection can record pulls. */
export const variantKey = keyFor;

/**
 * Split a pack into what is new and what is not.
 *
 * `owned` is not mutated: the caller decides whether a pack that failed to
 * save should still have been counted. Its keys are whatever `keyFor` would
 * produce -- plain ids, plus `id#shiny` for anything owned as shiny -- which
 * `ownershipKeys` builds from a collection's two separate sets.
 */
export function settle(pulled: readonly Card[], owned: ReadonlySet<string>): Settlement {
  const fresh: Card[] = [];
  const duplicates: Card[] = [];
  const seen = new Set(owned);

  for (const card of pulled) {
    const key = keyFor(card);
    if (seen.has(key)) {
      duplicates.push(card);
    } else {
      seen.add(key);
      fresh.push(card);
    }
  }
  const shards: Record<string, number> = {};
  for (const c of duplicates) {
    shards[c.id] = (shards[c.id] ?? 0) + shardsFor(c);
  }

  return {
    pulled: [...pulled],
    fresh,
    duplicates,
    coins: duplicates.reduce((a, c) => a + coinsFor(c.rarity), 0),
    shards,
  };
}
