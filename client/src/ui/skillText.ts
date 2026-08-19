/**
 * What a card's ability actually does, in words and numbers.
 *
 * Split out from `skillCard.ts`, which draws the animated preview and so needs
 * Phaser. This half needs nothing but the card tables -- and the guide, which
 * is a document with no canvas anywhere on it, was pulling all three megabytes
 * of the engine through this import to print one sentence.
 */


import type { Card } from "../core/cards";
import * as tiers from "../core/tiers";
import { config } from "../core/config";
import { SPECIES } from "../core/species";
import abilityFx from "../data/abilityFx.json";

export interface SkillInfo {
  /** The ability's own name, tidied for display. */
  name: string;
  /** One line on what firing it does. */
  summary: string;
  /** Damage at this card's stage, already mitigated-agnostic. */
  amount: number;
  /** Which defence reduces it. */
  resist: tiers.Resist;
  /** Attacks between casts. */
  every: number;
  /** Roughly how many seconds that is, at this card's attack rate. */
  seconds: number;
  /** Damage per evolution stage, where the source declares one. */
  perStage?: number[];
  /** True when the figure is derived rather than declared. */
  estimated: boolean;
  /** Seconds between landing and acting. Bigger creatures take longer. */
  deployDelay: number;
}

const pretty = (skill: string) =>
  skill.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function skillOf(card: Card): SkillInfo {
  const info = SPECIES[card.id];
  const declared = tiers.abilityOf(card.skill);
  const { amount, resist } = tiers.skillDamage(card, card.damage * config.skillDamage);
  const every = card.castEvery;

  const resistWord =
    resist === "physical" ? "reduced by armour"
    : resist === "special" ? "reduced by special defence"
    : "ignores all defence";

  return {
    name: pretty(card.skill),
    // One sentence, not two glued at a full stop -- the resist clause was
    // reading as "for half. reduced by special defence." wherever the summary
    // is shown at length, which the guide now does.
    summary:
      `Hits its target for ${Math.round(amount)}, and everything within ` +
      `${config.skillRadius} units for half — ${resistWord}.`,
    amount: Math.round(amount),
    resist,
    every,
    seconds: every * card.attackRate,
    perStage: declared?.damage,
    estimated: !declared,
    deployDelay: card.deployDelay,
    // maxPP is what sets the cadence, and it is worth surfacing because it is
    // the least guessable number on the card.
    ...(info ? {} : {}),
  };
}

/** The animation key for a card's ability effect, if the pack has one. */
export function fxKeyFor(card: Card): string | undefined {
  const info = (abilityFx as Record<string, { sheet: string } | undefined>)[card.skill];
  return info ? `fx:${info.sheet}` : undefined;
}
