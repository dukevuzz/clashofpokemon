/** What a match actually does, as a list. */

import { Match, AI, config, cards } from "../src/core/index.js";
import { recorder } from "../src/core/trace.js";
import * as hand from "../src/core/hand.js";

const SIM = 1 / 30;

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rec = recorder();
let matches = 0;

for (let seed = 1; seed <= 12; seed++) {
  const rng = mulberry32(seed);
  // Both sides bots so the match plays itself -- except that neither is marked
  // a bot, so branch offers are *raised* rather than auto-taken. That is the
  // path a human takes, and the one the protocol has to carry.
  const m = new Match({ rng, trace: rec.trace, bot: {} });
  // Seeded from the match, not Math.random. AI's rng parameter defaults to
  // Math.random, so a bot left to itself makes the whole match unrepeatable --
  // two runs of these same twelve seeds gave different action counts until
  // this line existed.
  const ai = [new AI(config.PLAYER, rng), new AI(config.ENEMY, rng)];
  let steps = 0;
  while (!m.over && steps < 6000) {
    m.update(SIM);
    for (const a of ai) a.update(m, SIM);
    // Answer any offer the way a client would: by name, naming the offer.
    for (const side of [config.PLAYER, config.ENEMY] as const) {
      const o = m.pendingChoice[side];
      if (o) m.takeChoice(side, o.id, o.options[0].id);
    }
    // Exercise the one action a bot never takes: choosing a body.
    if (steps % 900 === 0) {
      const held = m.hand[config.PLAYER].find((c) => c?.forms.length);
      if (held) hand.cycleForm(m, config.PLAYER, held);
    }
    steps++;
  }
  matches++;
}

const rows = rec.rows();
const pad = (s: string, n: number) => s.padEnd(n);
let last = "";
console.log(`\n${matches} matches, ${rows.length} distinct actions\n`);
for (const r of rows) {
  if (r.reach !== last) {
    last = r.reach;
    console.log(`\n  ${r.reach.toUpperCase()}`);
  }
  const d = r.first.detail ?? {};
  const keys = Object.keys(d).join(" ");
  console.log(`    ${pad(r.name, 22)} ${String(r.count).padStart(9)}   ${keys}`);
}

// Anything a card can do that no match happened to do is a hole in the sample,
// not a hole in the protocol -- and worth saying out loud either way.
const skills = new Set(cards.ALL.map((c) => c.skill));
console.log(`\n  sample covered ${matches} matches; roster has ${skills.size} distinct skills\n`);
