/** Golden answers from the rules that exist, for the rules being written. */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as tiers from "../src/core/tiers.js";
import * as status from "../src/core/status.js";
import * as species from "../src/core/species.js";
import * as cards from "../src/core/cards.js";
import * as evolution from "../src/core/evolution.js";
import { config } from "../src/core/config.js";
import * as mv from "../src/core/movement.js";

/** The generator both engines run. Ported verbatim; see MulberryTest in Java. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUT = "../server/src/test/resources/fixtures.json";

/** Damage after armour. The curve every hit in the game passes through. */
const mitigation = [];
for (const amount of [0, 1, 7, 42, 99, 250, 886]) {
  for (const defence of [0, 1, 3, 8, 16, 40]) {
    mitigation.push({ amount, defence, out: tiers.mitigate(amount, defence) });
  }
}

/** Type effectiveness, for every pairing. */
// Species against species, not type against type.
const roster = cards.ALL.map((c) => c.id);
const effectiveness = [];
for (const attack of roster) {
  for (const defend of roster) {
    const out = species.typeMultiplier(attack, defend);
    // Only the interesting cells: neutral is the default and 16,000 rows of it
    // would bury the ones that matter.
    if (out !== 1) effectiveness.push({ attack, defend, out });
  }
}

/** What a status does, and for how long. */
const statuses = Object.entries(status.MOVE_STATUS).map(([move, effect]) => ({
  move, kind: effect.kind, seconds: effect.seconds, chance: effect.chance,
}));

/** Applying a status twice extends rather than stacks, and a shorter one does not cut a longer one short. */
const statusSequences = [];
for (const steps of [
  [["burn", 2], ["burn", 5]],
  [["burn", 5], ["burn", 1]],
  [["burn", 2], ["poison", 3]],
  [["sleep", 4]],
]) {
  const list: status.Status[] = [];
  for (const [kind, seconds] of steps as [status.StatusKind, number][]) {
    status.apply(list, kind, seconds);
  }
  statusSequences.push({
    steps,
    after: list.map((s) => ({ kind: s.kind, left: s.left })),
  });
}

/** Ticking one down, and what expires when. */
const statusTicks = [];
{
  const list: status.Status[] = [];
  status.apply(list, "freeze", 1);
  status.apply(list, "burn", 3);
  for (const dt of [0.5, 0.6, 1.0, 1.0]) {
    status.tick(list, dt);
    statusTicks.push({ dt, left: list.map((s) => ({ kind: s.kind, left: +s.left.toFixed(4) })) });
  }
}

/** Every card's numbers, as the rules compute them. */
const cardStats = cards.ALL.map((c) => ({
  id: c.id, hp: c.hp, damage: c.damage, range: c.range, speed: c.speed,
  attackRate: c.attackRate, def: c.def, speDef: c.speDef, mass: c.mass,
  elixir: c.elixir, count: c.count, castEvery: c.castEvery,
  flying: c.flying, jumpsRiver: c.jumpsRiver, targets: [...c.targets],
  skill: c.skill, rarity: c.rarity, role: c.role,
}));

/** What each card evolves into, and after how many plays. */
const evolutions = cards.ALL.map((c) => ({
  id: c.id,
  needs: evolution.playsNeeded(c) ?? 0,
  chain: evolution.chainOf(c.id) ?? [c.id],
}));

/** Movement, sampled across the board. */
const movement = [];
{
  const ys = [0, 100, config.riverY - 30, config.riverY, config.riverY + 30, 400, 640];
  for (const y of ys) movement.push({ fn: "bankOf", in: [y], out: mv.bankOf(y) });
  for (const x of [0, 40, config.bridgeX[0], config.bridgeX[0] + 20, config.bridgeX[1], 300]) {
    movement.push({ fn: "onBridge", in: [x], out: mv.onBridge(x) });
  }
}

/** Where a crossing creature heads next, from a handful of real positions. */
const wayToCases = [];
{
  const card = cards.byId("charmander")!;
  for (const lane of [0, 1] as const) {
    for (const y of [80, 300, config.riverY, 500, 620]) {
      for (const ty of [80, 620]) {
        const u = {
          x: config.bridgeX[lane], y, lane, flying: false, jumpsRiver: false,
          card, speed: card.speed, mass: card.mass,
        } as unknown as Parameters<typeof mv.wayTo>[0];
        const out = mv.wayTo(u, config.bridgeX[lane], ty);
        wayToCases.push({ lane, y, ty, out: [round(out.x), round(out.y)] });
      }
    }
  }
}

function round(n: number) { return Math.round(n * 1000) / 1000; }

/*
 * The deck a seed deals, when nobody brought one.
 *
 * The two engines sampled the same pool with the same generator and got
 * different decks: this one shuffles the whole pool and takes the first six,
 * the Java one pulled six at random out of the middle. Both are fair; they
 * consume the generator differently, so seed 9 dealt hoppip here and ditto
 * there. Nothing caught it, because every differential match hands both
 * engines an explicit deck and this path is only walked by bots and tests.
 */
const decks = Array.from({ length: 24 }, (_, i) => {
  const seed = i + 1;
  return { seed, cards: cards.newDeck(mulberry32(seed)).map((c) => c.id) };
});

const fixtures = {
  note: "generated by tools/export-fixtures.ts -- do not edit",
  config: {
    arenaWidth: config.arenaWidth, arenaHeight: config.arenaHeight,
    riverY: config.riverY, riverHeight: config.riverHeight,
    bridgeX: config.bridgeX, bridgeHalfWidth: config.bridgeHalfWidth,
    elixirMax: config.elixirMax, elixirRate: config.elixirRate,
    matchSeconds: config.matchSeconds, deckSize: config.deckSize,
    handSize: config.handSize, unitSize: config.unitSize,
    crowding: config.crowding,
  },
  mitigation,
  effectiveness,
  statuses,
  statusSequences,
  statusTicks,
  movement,
  wayTo: wayToCases,
  cards: cardStats,
  evolutions,
  decks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(fixtures, null, 2) + "\n");

console.log("fixtures.json");
console.log(`  ${mitigation.length} mitigation cases`);
console.log(`  ${fixtures.effectiveness.length} type pairings`);
console.log(`  ${statuses.length} status effects, ${statusSequences.length} sequences`);
console.log(`  ${cardStats.length} cards, ${evolutions.length} evolution chains`);
console.log(`  ${decks.length} dealt decks`);
