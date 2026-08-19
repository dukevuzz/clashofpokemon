/** Does every card have an answer, and what would fix it? */

import * as fs from "node:fs";
import * as path from "node:path";
import { SPECIES, typesOf, typeMultiplier } from "../src/core/species.js";
import * as cards from "../src/core/cards.js";
import * as evolution from "../src/core/evolution.js";
import { ROSTER } from "../src/core/roster.js";

/** How many roster forms should be able to answer a type before it counts as having a real answer. */
const FLOOR = 12;

/** Decks sampled. 3000 is stable to ~0.2 points; 300 is enough to rank. */
const DECKS_REPORT = 3000;
const DECKS_RANK = 400;

const chainOf = (id: string): string[] => evolution.chainOf(id) ?? [id];
const isBase = (id: string) =>
  !Object.keys(SPECIES).some((o) => evolution.nextOf(o) === id);

/** Every form a player can field today: base cards plus what they grow into. */
function playable(): string[] {
  const out = new Set<string>();
  for (const c of cards.ALL) for (const s of chainOf(c.id)) out.add(s);
  return [...out];
}

/** Forms that hit a pure defender of type `t` for >=2x. */
function answersToType(pool: string[], t: string): number {
  const probe = Object.keys(SPECIES).find(
    (s) => typesOf(s).length === 1 && typesOf(s)[0] === t,
  );
  if (!probe) return 0;
  return pool.filter((a) => typeMultiplier(a, probe) >= 2).length;
}

/** Blindness, over seeded random 6-card decks. */
function blindnessOf(pool: string[], baseIds: string[], decks: number, seed = 12345): number {
  const index = new Map(pool.map((s, i) => [s, i]));
  const words = Math.ceil(pool.length / 32);
  const answer: Uint32Array[] = pool.map((t) => {
    const bits = new Uint32Array(words);
    for (let j = 0; j < pool.length; j++) {
      if (typeMultiplier(pool[j], t) >= 2) bits[j >> 5] |= 1 << (j & 31);
    }
    return bits;
  });

  let rng = seed;
  const rand = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
  let total = 0;
  const deckBits = new Uint32Array(words);
  for (let d = 0; d < decks; d++) {
    deckBits.fill(0);
    const pick = [...baseIds].sort(() => rand() - 0.5).slice(0, 6);
    for (const id of pick) {
      for (const f of chainOf(id)) {
        const i = index.get(f);
        if (i !== undefined) deckBits[i >> 5] |= 1 << (i & 31);
      }
    }
    let blind = 0;
    for (let t = 0; t < pool.length; t++) {
      const a = answer[t];
      let hit = 0;
      for (let w = 0; w < words; w++) hit |= a[w] & deckBits[w];
      if (hit === 0) blind++;
    }
    total += blind / pool.length;
  }
  return total / decks;
}

// --------------------------------------------------------------------- report

const pool = playable();
const TYPES = [...new Set(pool.flatMap(typesOf))].sort();
const baseIds = cards.ALL.map((c) => c.id);

console.log(`playable forms: ${pool.length}   base cards: ${baseIds.length}\n`);
console.log("answers available per defending type:");
for (const { t, n } of TYPES.map((t) => ({ t, n: answersToType(pool, t) }))
  .sort((a, b) => a.n - b.n)) {
  console.log(`  ${t.padEnd(9)} ${String(n).padStart(3)}${n < FLOOR ? "  THIN" : ""}`);
}
const base = blindnessOf(pool, baseIds, DECKS_REPORT);
console.log(`\nblindness: ${(100 * base).toFixed(1)}% of enemy forms an average deck cannot answer`);

// ----------------------------------------------------------------- candidates

if (process.argv[2] === "pick") {
  const want = Number(process.argv[3] ?? 6);
  const pac = process.argv[4] ?? "../../pokemonAutoChess";

  // Drawable means PAC ships a sheet for every form in the chain. A chain with
  // one undrawable member is not addable at all: you cannot field a line that
  // dead-ends on a form nobody can see, and evolution refuses to promote into
  // a form with no sheet (BootScene sets that check deliberately).
  const enumSrc = fs.readFileSync(
    path.join(pac, "app/types/enum/Pokemon.ts"), "utf8");
  const indexOf = new Map<string, string>();
  for (const m of enumSrc.matchAll(/\[Pkm\.([A-Z0-9_]+)\]:\s*"([0-9-]+)"/g)) {
    indexOf.set(m[1].toLowerCase(), m[2]);
  }
  const assets = path.join(pac, "app/public/src/assets/pokemons");
  const sheets = new Set(
    fs.readdirSync(assets).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));

  /** Drawable means a sheet exists AND it has an Attack animation. */
  const hasAttack = (index: string) => {
    const raw = fs.readFileSync(path.join(assets, `${index}.json`), "utf8");
    return raw.includes("/Attack/");
  };
  const drawable = (s: string) => {
    const i = indexOf.get(s);
    return i !== undefined && sheets.has(i) && hasAttack(i);
  };

  const onRoster = new Set(ROSTER);
  const candidates = Object.keys(SPECIES)
    .filter((id) => isBase(id) && !onRoster.has(id))
    .map((id) => ({ id, line: chainOf(id) }))
    .filter((c) => c.line.every(drawable));

  console.log(`\n${candidates.length} drawable chains not already on the roster.`);
  console.log("ranking by blindness removed (a new chain is also a new threat):\n");

  const chosen: string[] = [];
  let live = [...pool];
  let liveBase = [...baseIds];
  let current = blindnessOf(live, liveBase, DECKS_RANK);

  for (let round = 0; round < want; round++) {
    let best: { id: string; line: string[]; after: number } | undefined;
    for (const c of candidates) {
      if (chosen.includes(c.id)) continue;
      const after = blindnessOf([...live, ...c.line], [...liveBase, c.id], DECKS_RANK);
      if (!best || after < best.after) best = { id: c.id, line: c.line, after };
    }
    if (!best || best.after >= current) {
      console.log("  (nothing further reduces blindness)");
      break;
    }
    console.log(
      `  ${(round + 1).toString().padStart(2)}. ${best.id.padEnd(12)} ` +
      `${best.line.map((s) => typesOf(s).join("/")).join(" -> ").padEnd(34)} ` +
      `chain ${best.line.length}   blindness ${(100 * current).toFixed(1)}% -> ${(100 * best.after).toFixed(1)}%`,
    );
    chosen.push(best.id);
    live = [...live, ...best.line];
    liveBase = [...liveBase, best.id];
    current = best.after;
  }

  const after = blindnessOf(live, liveBase, DECKS_REPORT);
  console.log(`\nwith all ${chosen.length} added:`);
  for (const { t, n0, n1 } of TYPES.map((t) => ({
    t, n0: answersToType(pool, t), n1: answersToType(live, t),
  })).filter((r) => r.n0 !== r.n1).sort((a, b) => a.n1 - b.n1)) {
    console.log(`  ${t.padEnd(9)} ${String(n0).padStart(3)} -> ${String(n1).padStart(3)}`);
  }
  console.log(`  blindness  ${(100 * base).toFixed(1)}% -> ${(100 * after).toFixed(1)}%`);
  console.log(`  sprites to add: ${chosen.flatMap(chainOf).length}`);
  console.log(`\n  ROSTER additions: ${chosen.map((c) => `"${c}"`).join(", ")}`);
}
