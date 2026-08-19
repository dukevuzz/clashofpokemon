/**
 * How matches END, which is what aggro changes.
 *
 * Raising how far a creature notices things makes lanes fight more and reach
 * towers less. The config's tuning notes target roughly a 55/45 split between
 * a king falling and the clock running out; this is the number to watch.
 */
import { Match } from "../src/core/match";
import { AI } from "../src/core/ai";
import { config } from "../src/core/config";
import * as cards from "../src/core/cards";

const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const N = Number(process.argv[2] ?? 400);
const STEP = 1 / 30;
let king = 0, clock = 0, draws = 0, secs = 0, fights = 0;

for (let i = 0; i < N; i++) {
  const rng = seeded(9000 + i);
  const m = new Match({ playerDeck: cards.newDeck(rng), enemyDeck: cards.newDeck(rng), rng });
  const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
  let steps = 0;
  while (!m.over && steps++ < 20000) {
    m.update(STEP); p.update(m, STEP); e.update(m, STEP);
    // How often creatures are actually fighting each other rather than walking.
    if (steps % 30 === 0) {
      fights += m.units.filter((u) => u.target && !u.target.isTower).length;
    }
  }
  const left = m.towers.filter((t) => t.kind === "king" && t.dead).length;
  if (left > 0) king++; else if (m.over === "draw") draws++; else clock++;
  secs += config.matchSeconds - m.time;
}

const pct = (n: number) => `${((n / N) * 100).toFixed(0)}%`;
console.log(`${N} matches`);
console.log(`  king fell : ${pct(king)}`);
console.log(`  clock     : ${pct(clock)}`);
console.log(`  draw      : ${pct(draws)}`);
console.log(`  avg length: ${(secs / N).toFixed(0)}s`);
console.log(`  creature-vs-creature engagements per sample: ${(fights / N).toFixed(1)}`);
