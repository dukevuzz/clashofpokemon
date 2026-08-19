/** Does a tower troop change anything, and does any of them win? */

import { Match, AI, config, towerTroops } from "../src/core/index.js";

const N = Number(process.argv[2] ?? 400);
const ids = towerTroops.TROOPS.map((t) => t.id);

console.log("the statlines as designed:\n");
console.log("  troop        hp   dmg   rate   reach   sustained   burst");
for (const t of towerTroops.TROOPS) {
  console.log(
    `  ${t.name.padEnd(11)} ${String(t.hp).padStart(4)} ${String(t.damage).padStart(5)} ` +
    `${t.rate.toFixed(2).padStart(6)} ${String(t.reach).padStart(7)} ` +
    `${towerTroops.sustainedDps(t).toFixed(1).padStart(11)} ` +
    `${towerTroops.burstDps(t).toFixed(1).padStart(7)}`);
}

/** One match, returning +1 if the player's troop won. */
function play(playerTroop: string, enemyTroop: string, seed: number) {
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const m = new Match({ rng, playerTroop, enemyTroop });
  const ais = [new AI(config.PLAYER), new AI(config.ENEMY)];
  let t = 0;
  while (!m.over && t < 400) { for (const a of ais) a.update(m, 1 / 30); m.update(1 / 30); t += 1 / 30; }
  return m.over;
}

console.log(`\nhead to head, ${N} matches each way per pairing, identical seeds.`);
console.log("each cell is the ROW troop's win rate against the COLUMN troop.\n");
process.stdout.write("               " + ids.map((i) => i.slice(0, 9).padStart(10)).join("") + "      field\n");

const field: Record<string, number[]> = {};
for (const a of ids) {
  let row = `  ${a.padEnd(13)}`;
  const scores: number[] = [];
  for (const b of ids) {
    if (a === b) { row += "         --"; continue; }
    let wins = 0, games = 0;
    for (let k = 0; k < N; k++) {
      // Play both seats so the side bias cancels out.
      const r1 = play(a, b, 1000 + k * 7919);
      if (r1 === "player") wins++;
      if (r1 !== "draw") games++;
      const r2 = play(b, a, 1000 + k * 7919);
      if (r2 === "enemy") wins++;
      if (r2 !== "draw") games++;
    }
    const pct = (100 * wins) / games;
    scores.push(pct);
    row += `${pct.toFixed(1).padStart(11)}`;
  }
  field[a] = scores;
  const avg = scores.reduce((x, y) => x + y, 0) / scores.length;
  console.log(`${row}${avg.toFixed(1).padStart(11)}`);
}

const flat = Object.entries(field).map(([k, v]) => [k, v.reduce((x, y) => x + y, 0) / v.length] as const);
flat.sort((a, b) => b[1] - a[1]);
const spread = flat[0][1] - flat[flat.length - 1][1];
console.log(`\n  best ${flat[0][0]} ${flat[0][1].toFixed(1)}%, worst ${flat[flat.length-1][0]} ${flat[flat.length-1][1].toFixed(1)}%`);
console.log(`  spread ${spread.toFixed(1)} points.`);
console.log(`  95% confidence on a cell here is about +/-${(100/Math.sqrt(2*N)).toFixed(1)} points.`);
console.log(spread < 8
  ? "  -> no troop dominates; these are sidegrades."
  : "  -> SPREAD TOO WIDE. Something here is a strict upgrade, not a choice.");
