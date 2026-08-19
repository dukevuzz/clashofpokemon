/** Is the opponent cheating? */
import { Match, AI, config } from "../src/core/index.js";

const STEP = 1 / 30;
let pGained = 0, eGained = 0, pSpent = 0, eSpent = 0, pPlays = 0, ePlays = 0;
let firstPlay = { player: 0, enemy: 0 };

for (let g = 0; g < 12; g++) {
  const m = new Match({});
  const p = new AI(config.PLAYER), e = new AI(config.ENEMY);
  let seenFirst = { 1: false, 2: false };

  while (!m.over) {
    const t0 = { 1: m.elixir[1], 2: m.elixir[2] };
    m.update(STEP);
    // Whatever arrived during the step, before either side spent.
    pGained += m.elixir[1] - t0[1];
    eGained += m.elixir[2] - t0[2];

    const t1 = { 1: m.elixir[1], 2: m.elixir[2] };
    p.update(m, STEP);
    e.update(m, STEP);
    const dp = t1[1] - m.elixir[1], de = t1[2] - m.elixir[2];
    if (dp > 0) { pSpent += dp; pPlays++; if (!seenFirst[1]) { firstPlay.player += m.elapsed; seenFirst[1] = true; } }
    if (de > 0) { eSpent += de; ePlays++; if (!seenFirst[2]) { firstPlay.enemy += m.elapsed; seenFirst[2] = true; } }
  }
}

const f = (n: number) => n.toFixed(1);
console.log("over 12 matches, an identical AI on both sides:\n");
console.log(`  elixir received   player ${f(pGained)}   enemy ${f(eGained)}`);
console.log(`  elixir spent      player ${f(pSpent)}   enemy ${f(eSpent)}`);
console.log(`  cards played      player ${pPlays}       enemy ${ePlays}`);
console.log(`  first play at     player ${f(firstPlay.player / 12)}s   enemy ${f(firstPlay.enemy / 12)}s`);
console.log(`\n  config: rate ${config.elixirRate}/s, start ${config.startElixir}, max ${config.elixirMax}`);
console.log(`  doubles with ${config.suddenDeathAt}s left`);
