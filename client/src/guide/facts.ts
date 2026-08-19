/**
 * Every number the guide states, read from the game rather than typed.
 *
 * A wiki is worth less than nothing once it disagrees with the thing it
 * describes: a player who is told a tower has 1300 health and watches it die
 * at 546 stops believing the rest of the page too. Tuning happens in
 * `config.ts` and nowhere else, so the guide asks it, and a sweep that retunes
 * a tower rewrites this page as a side effect.
 *
 * Only prose lives in the sections. Anything with a digit in it comes through
 * here.
 */

import { config, towerRangeOf } from "../core/config";
import * as cards from "../core/cards";
import * as tiers from "../core/tiers";
import * as evolution from "../core/evolution";

/** World units per board tile, for turning engine distances into something sayable. */
const TILE = 24;

export const tiles = (units: number): string => (units / TILE).toFixed(1);

/** m:ss, because a match length written as "180 seconds" reads like a spec. */
export const clock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds - m * 60)).padStart(2, "0")}`;
};

export const facts = {
  match: {
    length: clock(config.matchSeconds),
    seconds: config.matchSeconds,
    /** The last stretch, when elixir doubles. */
    doubleFrom: clock(config.suddenDeathAt),
    doubleSeconds: config.suddenDeathAt,
    normalSeconds: config.matchSeconds - config.suddenDeathAt,
  },

  elixir: {
    max: config.elixirMax,
    perSecond: config.elixirRate,
    /** The figure players actually reason with: seconds per drop. */
    everySeconds: (1 / config.elixirRate).toFixed(1),
    everyDoubled: (1 / (config.elixirRate * 2)).toFixed(2),
    /** A full bar from empty, which is the real cost of overspending. */
    refillSeconds: Math.round(config.elixirMax / config.elixirRate),
  },

  towers: {
    side: {
      hp: config.towerHP.side,
      damage: config.towerDamage.side,
      range: Math.round(towerRangeOf("side")),
      rangeTiles: tiles(towerRangeOf("side")),
    },
    king: {
      hp: config.towerHP.king,
      damage: config.towerDamage.king,
      range: Math.round(towerRangeOf("king")),
      rangeTiles: tiles(towerRangeOf("king")),
      wakeSeconds: config.kingWakeSeconds,
    },
    /** Shots per second, the same for both. */
    rate: config.towerRate,
  },

  deck: {
    size: config.deckSize,
    hand: config.handSize,
    /** How many other cards you see before one comes back. */
    cycle: config.deckSize - config.handSize,
  },

  roster: {
    /** Deployable cards. Evolutions and bodies exist but are not chosen. */
    total: cards.ALL.length,
    rarities: tiers.RARITY_ORDER.length,
    types: [...new Set(cards.ALL.flatMap((c) => c.types))].length,
    cheapest: Math.min(...cards.ALL.map((c) => c.elixir)),
    dearest: Math.max(...cards.ALL.map((c) => c.elixir)),
  },

  deploy: {
    /** How far past the halfway line your own half reaches. */
    margin: config.deployMargin,
  },

  evolution: {
    /** Plays needed at each stage -- it gets dearer as the line goes on. */
    perStage: evolution.PLAYS_FOR_STAGE,
    /**
     * A worked example, picked rather than written.
     *
     * The prose used to claim an evolved card keeps its cost. It does not:
     * the evolved form replaces the old one in the hand *and* the deck, and it
     * is priced as itself. Charmander at 1 becoming Charmeleon at 3 is the
     * clearest illustration of that, so the page shows the real pair.
     */
    example: (() => {
      const base = cards.byId("charmander") ?? cards.ALL.find((c) => evolution.chainOf(c.id).length > 1);
      const next = base && evolution.nextOf(base.id);
      const grown = base && next ? cards.build(next, base) : undefined;
      return base && grown
        ? { from: base.name, fromCost: base.elixir, to: grown.name, toCost: grown.elixir,
            plays: evolution.playsNeeded(base) ?? 0 }
        : undefined;
    })(),
  },
} as const;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * What each role actually looks like, measured off the roster.
 *
 * Written by hand first, and five of the seven descriptions were wrong: tanks
 * were called damage sponges when they have both the highest health *and* the
 * highest damage; runners were called fragile when they are the second
 * toughest thing in the game; artillery was said to outrange towers when
 * nothing in the game does. Printing the medians next to the words is what
 * makes the words checkable.
 */
export const roleStats = tiers.ROLES.map((role) => {
  const group = cards.ALL.filter((c) => c.role === role);
  return {
    role,
    count: group.length,
    elixir: median(group.map((c) => c.elixir)),
    hp: median(group.map((c) => c.hp)),
    dps: Math.round(median(group.map(dpsOfRaw))),
    speed: Math.round(median(group.map((c) => c.speed))),
    range: Math.round(median(group.map((c) => c.range))),
    melee: group.every((c) => c.range <= 30),
  };
}).filter((r) => r.count > 0);

function dpsOfRaw(c: cards.Card): number {
  return c.damage * c.count * c.attackRate;
}

/** The longest reach any card has, against what a tower has. */
export const reach = {
  best: Math.round(Math.max(...cards.ALL.map((c) => c.range))),
  tower: Math.round(towerRangeOf("side")),
};

/**
 * How long one card needs, alone and unopposed, to fell each tower.
 *
 * Worth stating because it is the question every new player actually has --
 * "can this thing take a tower on its own?" -- and the answer is arithmetic
 * nobody wants to do while a match is running.
 */
export function soloSeconds(card: cards.Card, kind: "side" | "king"): number {
  const dps = card.damage * card.count * card.attackRate;
  return dps > 0 ? config.towerHP[kind] / dps : Infinity;
}

/** Damage per second, counting every body a card brings. */
export const dpsOf = (card: cards.Card): number =>
  card.damage * card.count * card.attackRate;

/** Effective health, likewise. */
export const bulkOf = (card: cards.Card): number => card.hp * card.count;
