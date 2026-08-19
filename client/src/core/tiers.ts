/** Rarity and role: the two ways a card is classified. */

import { SPECIES, ABILITIES, typesOf } from "./species";

const TYPES_FLYING = (id: string) => typesOf(id).includes("FLYING");

// PAC's own `Rarity` enum, in PAC's own order: it ranks rarities in
// `core/trade-logic.ts` as cooldowns (common 1 ... legendary 10), which is a
// value ladder in all but name.
//
// `legendary` is almost entirely 3-star -- 99 of its 107 species have no
// earlier form -- so legendaries are cards you play, not cards you evolve into.
export const RARITY_ORDER = [
  "common", "uncommon", "rare", "epic", "hatch",
  "special", "ultra", "unique", "legendary",
] as const;

export type Rarity = (typeof RARITY_ORDER)[number];

export const RARITY_RANK: Record<string, number> = Object.fromEntries(
  RARITY_ORDER.map((name, i) => [name, i + 1]),
);

/*
 * Rarity colours used to live here as well as in `ui/theme.ts`, with different
 * values in each -- ultra was 0xff8c40 here and 0xff6b5e there, and only the
 * theme's had been fixed for contrast. Nothing read this copy in the end, and
 * the guide picked it by accident and rendered rarities the game does not use.
 *
 * One palette, in `ui/theme.ts`: `rarityColor(rarity)`. Colour is a UI concern
 * and `core/` has no business holding a second opinion about it.
 */

export const RARITY_SHORT: Record<string, string> = {
  common: "C", uncommon: "U", rare: "R", epic: "E", ultra: "UL",
  legendary: "L", unique: "Q", hatch: "H", special: "S",
};

/** Cost floor by rarity. */
export const RARITY_COST: Record<string, number> = {
  common: 1, uncommon: 2, rare: 2, epic: 3, hatch: 3,
  special: 3, ultra: 4, unique: 5, legendary: 6,
};

export type Role =
  | "artillery" | "sniper" | "skirmisher"
  | "runner" | "tank" | "bruiser" | "fighter";

export const ROLES: Role[] = [
  "artillery", "sniper", "skirmisher", "runner", "tank", "bruiser", "fighter",
];

/** Fast enough to outrun what it passes. */
export const RUNNER_SPEED = 58;

/** A runner gives up the ability to defend itself, so it has to actually arrive. */
export const RUNNER_SPEED_BONUS = 1.45;

/** Speed alone was not enough. */
export const RUNNER_HP_BONUS = 1.5;

export function rarityOf(species: string): string {
  return SPECIES[species]?.rarity ?? "common";
}

/** What a creature is, from range first because range decides how it is used. */
export function roleOf(species: string): Role {
  const info = SPECIES[species];
  if (!info) return "fighter";
  const { range = 1, def = 0, atk = 0, speed = 0, hp = 0 } = info;

  if (range >= 4) return "artillery";
  if (range === 3) return "sniper";
  if (range === 2) return "skirmisher";
  if (speed >= RUNNER_SPEED) return "runner";
  if (def >= 6 && hp >= 90) return "tank";
  if (atk >= 9) return "bruiser";
  return "fighter";
}


export function isRunner(role: Role, flying?: boolean): boolean {
  return role === "runner" && !flying;
}

/**
 * Roles convert PAC's abstract `range` (1..4 board squares) into world units.
 *
 * `aggro` is not a second attack range -- it is how far a creature *notices*
 * something: sight, hearing, sensing. It was set alongside range and came out
 * far too short, a median of 3.3 tiles, so creatures walked past each other in
 * the same lane. Clash Royale gives nearly everything about 5.5 tiles of sight
 * and lets attack range do the differentiating, which is the same conclusion.
 *
 * So sight is close to uniform now, and the lanes are 9.75 tiles apart, which
 * leaves plenty of room before anything could notice across the board.
 *
 * The runner is the deliberate exception. Being slow to notice is the whole of
 * what the role is: it is aimed at a tower rather than at the army, and giving
 * it ordinary sight would delete the archetype.
 *
 * Measured over 1,200 AI matches before and after: creature-versus-creature
 * engagements rose from 308 to 332 a match (+8%), while how matches end barely
 * moved -- a king fell in 35% before and 34% after, inside the noise at that
 * sample. More fighting, same decisiveness.
 */
export const ROLE_STATS: Record<Role, { range: number; aggro: number }> = {
  artillery: { range: 84, aggro: 138 },
  sniper: { range: 70, aggro: 132 },
  skirmisher: { range: 52, aggro: 132 },
  runner: { range: 15, aggro: 72 },
  tank: { range: 15, aggro: 132 },
  bruiser: { range: 15, aggro: 132 },
  fighter: { range: 15, aggro: 132 },
};

/** Damage is scaled by the same factor as health so the source ratios survive: a 30-damage ability against a 60hp creature has to stay half its health here. */
export const STAT_SCALE = 2.6;

export type Resist = "physical" | "special" | "none";

/** What a cast hits for, and which defence resists it. */
export function skillDamage(
  card: { skill?: string; stage?: number; damage?: number },
  fallback: number,
  /** Forced when the caller knows the move hits with the body. */
  force?: Resist,
): { amount: number; resist: Resist } {
  const info = card.skill ? ABILITIES[card.skill] : undefined;
  if (!info) return { amount: fallback, resist: force ?? "special" };

  const stage = Math.max(1, Math.min(4, card.stage ?? 1));
  const figure = info.damage[stage - 1] ?? info.damage[info.damage.length - 1];
  const amount = info.scalesWithAttack
    ? (card.damage ?? 0) * figure
    : figure * STAT_SCALE;

  const resist: Resist =
    info.attackType === "PHYSICAL" ? "physical"
    : info.attackType === "TRUE" ? "none"
    : "special";
  return { amount, resist };
}

/** A basic attack grants 10 PP in PAC (core/pokemon-state.ts), so a creature casts every maxPP/10 attacks. */
export const PP_PER_ATTACK = 10;

/** The raw ability record, for screens that want to show its real figures. */
export function abilityOf(skill?: string) {
  return skill ? ABILITIES[skill] : undefined;
}

export function attacksToCast(species: string): number {
  const pp = SPECIES[species]?.maxPP ?? 100;
  return Math.max(2, Math.round(pp / PP_PER_ATTACK));
}

/** PAC reduces damage by armour: damage / (1 + 0.05 * def). */
export const ARMOR_FACTOR = 0.05;

export function mitigate(amount: number, defence = 0): number {
  return amount / (1 + ARMOR_FACTOR * defence);
}

// ------------------------------------------------------------------ traits
//
// What a species can do that its role does not say. These read the same data
// the cards do, so the Pokedex and the game can never disagree about what a
// creature is -- which they would the moment either kept its own list.

export interface Traits {
  /** Ignores units and walks at towers: tank or runner. */
  wincon: boolean;
  /** Crosses the river anywhere instead of queueing for a bridge. */
  jumpsRiver: boolean;
  /** Skips the river entirely, and can only be hit by things that reach air. */
  flying: boolean;
  /** Does not move at all -- a building. */
  static: boolean;
  /** Outranges a tower, so it can siege from outside the return fire. */
  outrangesTower: boolean;
  /** Puts more than one body on the board. */
  swarm: boolean;
  /** Its ability ignores armour entirely. */
  trueDamage: boolean;
}

/** Everything notable about a species, derived rather than tagged. */
export function traitsOf(species: string, towerRange: number): Traits {
  const info = SPECIES[species];
  if (!info) {
    return { wincon: false, jumpsRiver: false, flying: false, static: false,
             outrangesTower: false, swarm: false, trueDamage: false };
  }
  const role = roleOf(species);
  const flying = TYPES_FLYING(species);
  const runner = isRunner(role, flying);
  return {
    // A card property, not a species one -- same as `swarm` below. What makes a
    // card a win condition is that it will not attack troops, and that lives in
    // `Card.targets`, which a bare species does not have. Reading it off the
    // role here is what let the price and the behaviour disagree.
    wincon: false,
    jumpsRiver: runner,
    flying,
    static: info.speed <= 1,
    outrangesTower: (ROLE_STATS[role]?.range ?? 0) >= towerRange,
    swarm: false, // body count is a card property, not a species one
    trueDamage: ABILITIES[info.skill]?.attackType === "TRUE",
  };
}
