/** The roster, as data the API can read. */

import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import * as cards from "../src/core/cards.js";
import { config, towerRangeOf } from "../src/core/config.js";
import { TROOPS } from "../src/core/towerTroops.js";
import { branchesFor } from "../src/core/evolution.js";
import { typesOf } from "../src/core/species.js";
import { CARD_TABLE } from "../src/core/cardTable.js";
import * as statusRules from "../src/core/status.js";
import * as evolutionRules from "../src/core/evolution.js";
import * as skillRules from "../src/core/skills.js";
import * as towerTroops from "../src/core/towerTroops.js";
import * as tiers from "../src/core/tiers.js";
import { SPREAD } from "../src/core/spread";

const OUT = "../api/src/main/resources/content.json";

/** The same roster, with the numbers the rules actually use. */
const RULES_OUT = "../server/src/main/resources/rules.json";

/*
 * Tables the Java engine reads straight from, rather than through rules.json.
 *
 * They used to be copied across by hand, and by the time anybody noticed the
 * server's species table was 29 creatures and 22 edits behind the client's --
 * every Mega missing, and the evolution links that were deliberately cut still
 * present. The differential tests could not see it because the fixtures they
 * compare against were generated from the same stale copy.
 *
 * Copied here so the two cannot drift again: there is one source, and it is
 * the client's.
 */
const SHARED = ["species.json", "typeChart.json", "abilities.json"];

/** Only what the API validates against and the client draws. */
const deckable = cards.ALL.map((c) => ({
  id: c.id,
  name: c.name,
  elixir: c.elixir,
  rarity: c.rarity,
  role: c.role,
  types: typesOf(c.id),
  sheet: c.sheet,
}));

const content = {
  // Every card a deck may contain: 127. Not the same as the wire's card table,
  // which is every card that can *appear* -- evolutions included -- and is
  // twice the size. A deck holds only what you can choose.
  cards: deckable,
  troops: TROOPS.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb })),
  // The branches Eevee offers, so a pre-committed branch can be validated.
  // Ids already -- branchesFor returns names, not cards. Mapping `.id` over
  // them produced eight nulls, which the Java side refused to load. That is
  // the generated-data contract doing its job: a shape mismatch fails at boot
  // rather than becoming a validator that rejects every branch.
  branches: branchesFor("eevee") ?? [],
  rules: {
    deckSize: config.deckSize,
    handSize: config.handSize,
    elixirMax: config.elixirMax,
    matchSeconds: config.matchSeconds,
  },
  // The wire's table, for the handshake check. Listed rather than hashed alone
  // so a mismatch can say *which* card differs instead of only that one does.
  wireCards: CARD_TABLE,
};

const json = JSON.stringify(content, null, 2);
const version = createHash("sha256").update(json).digest("hex").slice(0, 12);
const withVersion = JSON.stringify({ version, ...content }, null, 2) + "\n";

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, withVersion);

console.log(`content.json  version ${version}`);
console.log(`  ${content.cards.length} deckable cards`);
console.log(`  ${content.troops.length} troops`);
console.log(`  ${content.branches.length} eevee branches`);
console.log(`  ${content.wireCards.length} cards on the wire`);
console.log(`  ${(withVersion.length / 1024).toFixed(0)} KB -> ${OUT}`);

// Everything the rules need, already derived.
/** Every card that can appear, built the way the match builds it. */
const BUILT = (() => {
  const built = new Map<string, ReturnType<typeof cards.build>>();
  for (const c of cards.ALL) built.set(c.id, c);

  // Breadth-first, because a stage-three form needs its stage-two parent to
  // exist first -- and a branch (Eevee) has several children at one step.
  const queue = [...cards.ALL];
  while (queue.length) {
    const from = queue.shift()!;
    // Evolutions and bodies both. A body is not an evolution -- Deoxys picks
    // one instead of growing into it -- but it is built the same way, from the
    // card offering it, and it reaches the board just as often.
    const nexts = [
      ...(evolutionRules.branchesFor(from.id) ?? [evolutionRules.nextOf(from.id)]),
      ...from.forms,
    ];
    for (const next of nexts) {
      if (!next || built.has(next)) continue;
      const card = cards.build(next, from);
      if (!card) continue;
      built.set(next, card);
      queue.push(card);
    }
  }
  return built;
})();

const resolve = (id: string) => BUILT.get(id);

const rules = {
  version,
  // Bearings for creatures standing on top of each other. Shipped rather than
  // recomputed, because sin and cos are not bit-identical between V8 and the
  // JVM and that difference was the source of every cross-engine divergence
  // this project has chased. See core/spread.ts.
  spread: SPREAD.map(([x, y]) => [x, y]),
  config: {
    arenaWidth: config.arenaWidth, arenaHeight: config.arenaHeight,
    riverY: config.riverY, riverHeight: config.riverHeight,
    bridgeX: config.bridgeX, bridgeHalfWidth: config.bridgeHalfWidth,
    laneX: config.laneX, elixirMax: config.elixirMax,
    elixirRate: config.elixirRate, startElixir: config.startElixir,
    matchSeconds: config.matchSeconds, suddenDeathAt: config.suddenDeathAt,
    deckSize: config.deckSize, handSize: config.handSize,
    unitSize: config.unitSize, crowding: config.crowding,
    towerSize: config.towerSize, towerBox: config.towerBox,
    towerHP: config.towerHP, PLAYER: config.PLAYER, ENEMY: config.ENEMY,
    // Everything the movement, deploy and combat rules read.
    riverBypass: config.riverBypass, leapTime: config.leapTime,
    bridgeApproach: config.bridgeApproach, towerBackOff: config.towerBackOff,
    deployMargin: config.deployMargin, kingWakeSeconds: config.kingWakeSeconds,
    dropImpact: config.dropImpact, throwSpeed: config.throwSpeed,
    throwMinTime: config.throwMinTime, referenceBody: config.referenceBody,
    // A tunneller digs from its own king to where it was played, so both the
    // speed and the floor on the journey are rules the server has to know.
    tunnelSpeed: config.tunnelSpeed, deliveryTime: config.deliveryTime,
    aggroArc: config.aggroArc, projectileSpeed: config.projectileSpeed,
    skillRadius: config.skillRadius,
    towerRangeSide: towerRangeOf("side"), towerRangeKing: towerRangeOf("king"),
  },
  // Move to status, and the constants the effects use.
  // Skills: the tables, and the damage already resolved.
  skills: {
    shieldScale: 2.6,
    statScale: tiers.STAT_SCALE,
    radius: config.skillRadius,
    fallbackDamage: config.skillDamage,
    moveEffect: skillRules.MOVE_EFFECT,
    powered: skillRules.POWERED,
    deliberatelyDamage: [...skillRules.DELIBERATELY_DAMAGE],
  },

  // Evolution, as a table rather than a lookup through species data.
  evolution: {
    playsForStage: evolutionRules.PLAYS_FOR_STAGE,
    branchOffer: evolutionRules.BRANCH_OFFER,
    next: Object.fromEntries(
      [...new Set([...cards.ALL.map((c) => c.id), ...CARD_TABLE])]
        .map((id) => [id, evolutionRules.nextOf(id) ?? null])
        .filter(([, next]) => next !== null)),
    stage: Object.fromEntries(
      CARD_TABLE.map((id) => [id, evolutionRules.stageOf(id)])),
    branches: Object.fromEntries(
      CARD_TABLE.map((id) => [id, evolutionRules.branchesFor(id) ?? null])
        .filter(([, list]) => list !== null)),
  },
  statuses: {
    moves: statusRules.MOVE_STATUS,
    dotFraction: statusRules.DOT_FRACTION,
    dotInterval: statusRules.DOT_INTERVAL,
    armorBreak: statusRules.ARMOR_BREAK,
    paralysisSpeed: statusRules.PARALYSIS_SPEED,
  },
  /** The four creatures that can ride a lane tower, with their statlines. */
  troops: towerTroops.TROOPS.map((t) => ({
    id: t.id, name: t.name, species: t.species,
    hp: t.hp, damage: t.damage, reach: t.reach, rate: t.rate,
    volleyShots: t.volley?.shots ?? null, volleyReload: t.volley?.reload ?? null,
  })),
  towerDamage: config.towerDamage,
  towerRate: config.towerRate,
  /*
   * The deckable roster, in the order this client holds it.
   *
   * `cards[].deckable` already says *which* cards a deck may hold, and the
   * game server used to derive its pool from that -- which put the pool in
   * wire order, not this one. A deck dealt at random then differed between
   * the engines for the same seed, because the pool being sampled was
   * ordered differently on each side.
   *
   * Order is a rule here, not presentation, so it is exported rather than
   * inferred.
   */
  deckOrder: cards.ALL.map((c) => c.id),

  /** Every card that can appear, not every card a deck may hold. */
  cards: CARD_TABLE.map((id) => {
    const c = resolve(id);
    if (!c) throw new Error(`card table names ${id}, which does not build`);
    return {
      id: c.id, name: c.name, sheet: c.sheet, elixir: c.elixir,
      hp: c.hp, damage: c.damage, range: c.range, aggro: c.aggro,
      speed: c.speed, attackRate: c.attackRate, castEvery: c.castEvery,
      def: c.def, speDef: c.speDef, mass: c.mass, count: c.count,
      flying: c.flying, jumpsRiver: c.jumpsRiver, targets: [...c.targets],
      skill: c.skill, rarity: c.rarity, role: c.role,
      deployDelay: c.deployDelay, delivery: c.delivery ?? null,
      forms: [...c.forms],
      stage: c.stage ?? 1,
      deckable: cards.byId(id) !== undefined,
      // The skill's damage, already resolved from the ability table.
      skillAmount: tiers.skillDamage(
        { skill: c.skill, stage: c.stage, damage: c.damage },
        c.damage * config.skillDamage).amount,
      skillResist: tiers.skillDamage(
        { skill: c.skill, stage: c.stage, damage: c.damage },
        c.damage * config.skillDamage).resist,
    };
  }),
};
const rulesJson = JSON.stringify(rules, null, 2) + "\n";
mkdirSync(dirname(RULES_OUT), { recursive: true });
writeFileSync(RULES_OUT, rulesJson);
console.log(`  ${(rulesJson.length / 1024).toFixed(0)} KB -> ${RULES_OUT}`);

for (const name of SHARED) {
  const to = `../server/src/main/resources/${name}`;
  copyFileSync(`src/data/${name}`, to);
  console.log(`  copied ${name} -> ${to}`);
}
