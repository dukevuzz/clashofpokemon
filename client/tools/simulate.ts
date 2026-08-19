/** Headless balance simulation. */

import { Match, AI, config, cards } from "../src/core/index.js";

/** Deterministic RNG, so a surprising run can be reproduced. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Row {
  games: number;
  wins: number;
  towerDamage: number;
  allDamage: number;
  kills: number;
}

/** 2,000 by default, not 80. */
const games = Number(process.argv[2] ?? 2000);
const STEP = 1 / 30; // the rules are frame-rate independent; 30Hz is plenty
const stats = new Map<string, Row>();

const row = (id: string): Row => {
  let r = stats.get(id);
  if (!r) { r = { games: 0, wins: 0, towerDamage: 0, allDamage: 0, kills: 0 }; stats.set(id, r); }
  return r;
};

console.log(`playing ${games} matches, random decks both sides...\n`);

for (let g = 0; g < games; g++) {
  const rng = mulberry32(g * 2654435761);
  const playerDeck = cards.newDeck(rng);
  const enemyDeck = cards.newDeck(rng);
  // Snapshot the ids now. Match.countPlay swaps evolved forms into the deck
  // array in place, so reading it afterwards credits Charmeleon with the games
  // Charmander was chosen for -- and every one of them looked like a 100% win.
  const chosen: Array<[string[], "player" | "enemy"]> = [
    [[...new Set(playerDeck.map((c) => c.id))], "player"],
    [[...new Set(enemyDeck.map((c) => c.id))], "enemy"],
  ];
  const match = new Match({ playerDeck, enemyDeck, rng });
  const player = new AI(config.PLAYER, rng);
  const enemy = new AI(config.ENEMY, rng);

  // Attribute damage to the card that dealt it, not the unit.
  const seen = new Map<string, { tower: number; all: number; kills: number }>();
  const bump = (id: string) => {
    let s = seen.get(id);
    if (!s) { s = { tower: 0, all: 0, kills: 0 }; seen.set(id, s); }
    return s;
  };

  while (!match.over) {
    const events = match.update(STEP);
    player.update(match, STEP);
    enemy.update(match, STEP);

    for (const e of events) {
      if (e.type === "hit" && "card" in e.source) {
        const s = bump(e.source.card.id);
        s.all += e.amount;
        if (e.target.isTower) s.tower += e.amount;
      }
      if (e.type === "death" && !e.thing.isTower) {
        // Credit the kill to whoever landed the last hit -- the hit event for
        // it is immediately before this one in the same batch.
        const prior = events[events.indexOf(e) - 1];
        if (prior?.type === "hit" && "card" in prior.source) {
          bump(prior.source.card.id).kills += 1;
        }
      }
    }
  }

  for (const [ids, side] of chosen) {
    for (const id of ids) {
      const r = row(id);
      r.games += 1;
      if (match.over === side) r.wins += 1;
    }
  }
  for (const [id, s] of seen) {
    const r = row(id);
    r.towerDamage += s.tower;
    r.allDamage += s.all;
    r.kills += s.kills;
  }
}

const rows = [...stats.entries()]
  .map(([id, r]) => ({
    id,
    elixir: cards.byId(id)?.elixir ?? 0,
    games: r.games,
    win: r.games ? (100 * r.wins) / r.games : 0,
    tower: r.games ? r.towerDamage / r.games : 0,
    all: r.games ? r.allDamage / r.games : 0,
    kills: r.games ? r.kills / r.games : 0,
  }))
  // Evolved forms accumulate damage but are never *chosen*, so they have no
  // games and no win rate to report. They belong in the damage table, not here.
  .filter((r) => r.games > 0)
  .sort((a, b) => b.tower - a.tower);

console.log("card          cost  games  win%   TOWER dmg/game  all dmg  kills");
for (const r of rows) {
  console.log(
    `  ${r.id.padEnd(12)} ${String(r.elixir).padStart(3)} ` +
    `${String(r.games).padStart(6)} ${r.win.toFixed(1).padStart(6)} ` +
    `${r.tower.toFixed(0).padStart(11)} ${r.all.toFixed(0).padStart(12)} ` +
    `${r.kills.toFixed(2).padStart(6)}`,
  );
}

// Confidence, and -- more usefully -- what size of change this run could even
// see. A band says how wrong one number might be; the detectable effect says
// whether the comparison you are about to make is possible at all.
const median = rows.length ? rows[Math.floor(rows.length / 2)].games : 0;
const band = median ? 100 * 1.96 * Math.sqrt(0.25 / median) : 0;
// Two-proportion test, alpha 0.05, power 0.80.
const mde = median ? 100 * (1.96 + 0.84) * Math.sqrt(0.5 / median) : 0;

console.log(`\n  ~${median} games per card.`);
console.log(`  95% confidence on any single number: +/-${band.toFixed(0)} points.`);
console.log(`  smallest change this run could detect: ${mde.toFixed(0)} points.`);
if (mde > 8) {
  console.log(`\n  That is too coarse for tuning. A 4-9% stat change -- which is the`);
  console.log(`  modal Clash Royale correction -- moves a win rate by 2-4 points and`);
  console.log(`  would be invisible here. Run \`npm run sim -- 4500\` before believing`);
  console.log(`  any small change did something.`);
}
