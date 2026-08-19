/** Evolution: a card you keep playing grows into its next form. */

import { SPECIES } from "./species";
import { build, byId, type Card } from "./cards";

export const PLAYS_FOR_STAGE: Record<number, number> = { 1: 2, 2: 3, 3: 4 };

/** The source writes some evolutions with an underscore; the key has none. */
const normalise = (name?: string) => name?.replace(/_/g, "");

/** A few chains the source leaves open. */
const EXTRA_EVOLUTION: Record<string, string> = {
  pikachu: "raichu",
};

/** Branching evolution. */
export const BRANCHES: Record<string, string[]> = {
  eevee: ["vaporeon", "jolteon", "flareon", "espeon",
          "umbreon", "leafeon", "glaceon", "sylveon"],
};

/** Three of the eight, not all eight: picking from everything is a menu, picking from three is a decision you can make in a real-time match. */
export const BRANCH_OFFER = 3;

/** Sheets that exist, so we never evolve into something we cannot draw. */
let drawable: (name: string) => boolean = () => true;
export function setDrawableCheck(fn: (name: string) => boolean) {
  drawable = fn;
}

export function branchesFor(species: string): string[] | undefined {
  const list = BRANCHES[species];
  if (!list) return undefined;
  const usable = list.filter((n) => SPECIES[n] && drawable(n));
  return usable.length > 0 ? usable : undefined;
}

/** A random offer of BRANCH_OFFER forms, without repeats. */
export function offerFor(species: string, rng: () => number = Math.random): Card[] | undefined {
  const pool = branchesFor(species);
  if (!pool) return undefined;
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  const from = byId(species);
  return copy
    .slice(0, Math.min(BRANCH_OFFER, copy.length))
    .map((n) => build(n, from))
    .filter((c): c is Card => c !== undefined);
}

export function nextOf(species?: string): string | undefined {
  if (!species) return undefined;
  const next = normalise(SPECIES[species]?.evolution) ?? EXTRA_EVOLUTION[species];
  if (!next || !SPECIES[next]) return undefined;
  return next;
}

export function stageOf(species: string): number {
  return SPECIES[species]?.stars ?? 1;
}

/** How many plays this card needs before it changes. undefined means terminal. */
export function playsNeeded(card?: Card): number | undefined {
  if (!card) return undefined;
  if (BRANCHES[card.id]) return PLAYS_FOR_STAGE[stageOf(card.id)];
  if (!nextOf(card.id)) return undefined;
  return PLAYS_FOR_STAGE[stageOf(card.id)] ?? PLAYS_FOR_STAGE[3];
}

/** The evolved card, or undefined if terminal or its sprite is missing. */
export function evolve(card: Card): Card | undefined {
  const next = nextOf(card.id);
  if (!next || !drawable(next)) return undefined;
  return build(next, card);
}

/** Every form this species can reach, itself included. */
export function chainOf(species: string): string[] {
  const out = new Set<string>([species]);
  const walk = (name: string) => {
    if (BRANCHES[name]) for (const b of BRANCHES[name]) out.add(b);
    const next = nextOf(name);
    if (next && !out.has(next)) {
      out.add(next);
      walk(next);
    }
  };
  walk(species);
  return [...out];
}

/** The full evolution line a species sits in, walked in both directions. */
export function lineOf(species: string): string[] {
  const chain = [species];
  let cur = species;
  for (let i = 0; i < 3; i++) {
    const next = nextOf(cur);
    if (!next) break;
    chain.push(next);
    cur = next;
  }
  // Backward until there is no predecessor, not once.
  //
  // A single step was enough for a middle form and wrong for a final one:
  // lineOf("kingambit") returned "bisharp -> kingambit" while
  // lineOf("bisharp") returned the full "pawniard -> bisharp -> kingambit".
  // Callers that reduce a species to the base of its line -- which is what a
  // deck slot is -- got a different answer depending on which member of the
  // chain they happened to ask about.
  //
  // Bounded by the longest chain in the data rather than `while (true)`: the
  // scan is over species that record what they become, and a data error that
  // made two forms point at each other would otherwise hang the caller.
  for (let i = 0; i < 4; i++) {
    const prev = Object.keys(SPECIES).find((n) => nextOf(n) === chain[0]);
    if (!prev || chain.includes(prev)) break;
    chain.unshift(prev);
  }
  return chain;
}
