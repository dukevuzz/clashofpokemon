/**
 * What crown tower health makes matches decisive again?
 *
 * The tuning notes in config.ts target roughly a 55/45 split between a king
 * falling and the clock deciding it, and say health -- not damage -- is the
 * lever: health is how big a push must be to take a tower. Defenders now
 * reliably distract attackers, so fewer pushes land and the split drifted to
 * 27/71. This walks health down and reports where it lands.
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
const mutable = config as unknown as { towerHP: { side: number; king: number } };
const baseSide = mutable.towerHP.side;
const baseKing = mutable.towerHP.king;

console.log(`crown  king   king fell   clock   avg length   (${N} matches each)`);
for (const scale of [1, 0.92, 0.85, 0.78, 0.7, 0.62]) {
  mutable.towerHP.side = Math.round(baseSide * scale);
  mutable.towerHP.king = Math.round(baseKing * scale);
  let king = 0, clock = 0, secs = 0;
  for (let i = 0; i < N; i++) {
    const rng = seeded(9000 + i);
    const m = new Match({ playerDeck: cards.newDeck(rng), enemyDeck: cards.newDeck(rng), rng });
    const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
    let steps = 0;
    while (!m.over && steps++ < 20000) { m.update(STEP); p.update(m, STEP); e.update(m, STEP); }
    if (m.towers.some((t) => t.kind === "king" && t.dead)) king++; else clock++;
    secs += config.matchSeconds - m.time;
  }
  const pct = (n: number) => `${((n / N) * 100).toFixed(0)}%`;
  console.log(`${String(mutable.towerHP.side).padStart(5)} ${String(mutable.towerHP.king).padStart(5)}`
    + `${pct(king).padStart(11)} ${pct(clock).padStart(7)} ${(secs / N).toFixed(0).padStart(11)}s`);
}
