/** Choose which species become cards. */

import { SPECIES, typesOf } from "../src/core/species.js";
import * as tiers from "../src/core/tiers.js";
import * as cards from "../src/core/cards.js";
import * as evolution from "../src/core/evolution.js";
import { towerRange } from "../src/core/config.js";
import { SHEETS } from "../src/data/sheets.js";

const arg = process.argv[2] ?? "200";
const unit = process.argv[3] === "sprites" ? "sprites" : "chains";
const dumpAll = arg === "all";
const budget = dumpAll ? Infinity : Number(arg);

/** What one more chain costs against the budget. */
const weigh = (c: { line: string[] }) => (unit === "sprites" ? c.line.length : 1);

/** Species the selector must never pick, and why each one. */
const EXCLUDE: Array<{ test: (id: string) => boolean; why: string }> = [
  {
    // 28 letters with identical stats. One is a card; twenty-eight is a bug.
    //
    // Keeping exactly one matters more than it looks: Unown is 28 of the 36
    // artillery chains in the entire dataset, so excluding the lot took 78% of
    // the artillery pool with it and left the role permanently 12 short of its
    // quota. One letter survives as the representative.
    test: (id) => id.startsWith("unown") && id !== "unowna",
    why: "Unown letter -- identical to unowna, which is kept",
  },
  {
    // Same failure, smaller: wing patterns and colour variants that differ in
    // nothing a player can act on. Regional forms are NOT here -- an Alolan
    // Geodude is Electric/Rock against a Geodude's Ground/Rock, which is a real
    // matchup difference; a Vivillon pattern is paint.
    test: (id) => /^vivillon(?!meadow)/.test(id)
      || /^tatsugiri(?!curly)/.test(id)
      || id === "latios",
    why: "cosmetic variant of a card already selected",
  },
  {
    // Eevee is already on the roster and branches into all eight. Having the
    // branches as standalone cards too means the same creature twice.
    test: (id) => (evolution.BRANCHES.eevee ?? []).includes(id),
    why: "Eeveelution -- reachable by evolving Eevee, so not its own card",
  },
  {
    // Every type at once: strong against everything, weak to nothing. There is
    // no counter-web position for a card with no bad matchups.
    test: (id) => typesOf(id).length > 4,
    why: "carries too many types to have a losing matchup",
  },
  {
    // A card that cannot cast and cannot fight is a slot doing nothing. The
    // pillars are useful as a building *mechanic*, not as content.
    test: (id) => (SPECIES[id]?.atk ?? 0) === 0 && (SPECIES[id]?.speed ?? 0) === 0
      && !id.startsWith("pillar") && id !== "bugnest",
    why: "immobile and harmless",
  },
];

const excluded = (id: string) => EXCLUDE.find((e) => e.test(id));

const isBase = (id: string) =>
  !Object.keys(SPECIES).some((o) => evolution.nextOf(o) === id);

interface Chain {
  id: string; line: string[]; cost: number; role: string; rarity: string;
  types: string[]; traits: tiers.Traits; hasArt: boolean; ability: boolean;
  hp: number; atk: number; speed: number;
}

const chains: Chain[] = Object.keys(SPECIES).filter(isBase)
  .filter((id) => !excluded(id))
  .map((id) => {
  const info = SPECIES[id];
  const role = tiers.roleOf(id);
  const types = typesOf(id);
  const flying = types.includes("FLYING");
  const traits = tiers.traitsOf(id, towerRange());
  const line = evolution.lineOf(id);
  return {
    id, line, role, types, traits,
    rarity: tiers.rarityOf(id),
    cost: cards.costOf(info, tiers.rarityOf(id), 1, {
      wincon: traits.wincon, jumps: traits.jumpsRiver, flying,
    }),
    hasArt: line.every((f) => SHEETS[f]),
    ability: Boolean(tiers.abilityOf(info.skill)),
    hp: info.hp, atk: info.atk, speed: info.speed,
  };
});

/** The roster we want, stated up front. */
const COST_SHARE: Record<number, number> = {
  1: 0.10, 2: 0.20, 3: 0.22, 4: 0.17, 5: 0.15, 6: 0.08, 7: 0.05, 8: 0.03,
};

/** Roles, and the thinking behind the numbers rather than the numbers alone. */
const ROLE_SHARE: Record<string, number> = {
  fighter: 0.24, skirmisher: 0.21, tank: 0.18, sniper: 0.14,
  runner: 0.12, bruiser: 0.06, artillery: 0.05,
};

/** Evolution is the differentiator, so most slots should actually evolve. */
const LEN_SHARE: Record<number, number> = { 1: 0.22, 2: 0.38, 3: 0.39, 4: 0.01 };

/** Quotas are shares of the target, not fixed counts, so the same shape holds at any budget. */
const TARGET = dumpAll ? 706 : (unit === "chains" ? budget : Math.round(budget / 2.1));
const quota = (share: Record<string | number, number>, k: string | number) =>
  Math.max(1, Math.round((share[k] ?? 0) * TARGET));
const COST_QUOTA = new Proxy({} as Record<number, number>, {
  get: (_t, k) => quota(COST_SHARE as Record<string|number, number>, Number(k)),
});
const ROLE_QUOTA = new Proxy({} as Record<string, number>, {
  get: (_t, k) => quota(ROLE_SHARE as Record<string|number, number>, String(k)),
});
const LEN_QUOTA = new Proxy({} as Record<number, number>, {
  get: (_t, k) => quota(LEN_SHARE as Record<string|number, number>, Number(k)),
});

/** What the set already covers. A chain earns its slot by adding to this. */
const have = {
  role: new Map<string, number>(),
  type: new Map<string, number>(),
  cost: new Map<number, number>(),
  trait: new Map<string, number>(),
  len: new Map<number, number>(),
};

const traitNames = (c: Chain) => {
  const t: string[] = [];
  if (c.traits.wincon) t.push("wincon");
  if (c.traits.jumpsRiver) t.push("jumps");
  if (c.traits.flying) t.push("air");
  if (c.traits.static) t.push("building");
  if (c.traits.outrangesTower) t.push("siege");
  if (c.traits.trueDamage) t.push("true");
  return t;
};

/** Marginal value: how much of what this chain offers is currently scarce. */
/** Is there still room in every quota this chain would consume? */
function fits(c: Chain): boolean {
  if ((have.cost.get(c.cost) ?? 0) >= (COST_QUOTA[c.cost] ?? 0)) return false;
  if ((have.role.get(c.role) ?? 0) >= (ROLE_QUOTA[c.role] ?? 0)) return false;
  if ((have.len.get(c.line.length) ?? 0) >= (LEN_QUOTA[c.line.length] ?? 0)) return false;
  return true;
}

/** Among the chains that fit, prefer the one filling the emptiest quota. */
function score(c: Chain): number {
  const room = (m: Map<string | number, number>, k: string | number, quota: number) =>
    quota > 0 ? (quota - (m.get(k) ?? 0)) / quota : 0;
  const scarcity = (m: Map<string | number, number>, k: string | number) =>
    1 / (1 + (m.get(k) ?? 0));

  let s = 0;
  s += 3.0 * room(have.cost as Map<string|number, number>, c.cost, COST_QUOTA[c.cost] ?? 0);
  s += 3.0 * room(have.role as Map<string|number, number>, c.role, ROLE_QUOTA[c.role] ?? 0);
  s += 1.5 * room(have.len as Map<string|number, number>, c.line.length, LEN_QUOTA[c.line.length] ?? 0);
  for (const t of c.types) s += 1.2 * scarcity(have.type as Map<string|number, number>, t);
  for (const t of traitNames(c)) s += 2.0 * scarcity(have.trait as Map<string|number, number>, t);
  // An ability with a declared figure actually does something when it casts.
  if (c.ability) s += 1.0;
  // Free if the art already exists -- a real saving, not a preference.
  if (c.hasArt) s += 2.0;
  return s;
}

function take(c: Chain) {
  have.role.set(c.role, (have.role.get(c.role) ?? 0) + 1);
  have.cost.set(c.cost, (have.cost.get(c.cost) ?? 0) + 1);
  have.len.set(c.line.length, (have.len.get(c.line.length) ?? 0) + 1);
  for (const t of c.types) have.type.set(t, (have.type.get(t) ?? 0) + 1);
  for (const t of traitNames(c)) have.trait.set(t, (have.trait.get(t) ?? 0) + 1);
}

// Anything already sprited is kept: it is paid for, and dropping a card the
// player has already met is a worse cost than a slightly lopsided curve.
const picked: Chain[] = [];
let sprites = 0;
// Existing art first: it is paid for, and dropping a card the player has
// already met costs more than a slightly lopsided curve. Quotas are widened
// rather than broken where these overflow -- see the report at the end.
for (const c of chains.filter((x) => x.hasArt).sort((a, b) => score(b) - score(a))) {
  picked.push(c); take(c); sprites += weigh(c);
}

const chosen = new Set(picked);
const pool = chains.filter((c) => !chosen.has(c));
while (sprites < budget) {
  let best: Chain | undefined, bestScore = -1;
  for (const c of pool) {
    if (chosen.has(c)) continue;
    if (sprites + weigh(c) > budget) continue;
    if (!dumpAll && !fits(c)) continue;
    const s = score(c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  if (!best) break;
  picked.push(best); chosen.add(best); take(best); sprites += weigh(best);
}

// Second pass. The first stops when every quota it can satisfy is full, which
// leaves the specialist roles short -- artillery chains are rare, and one that
// also lands in an open cost band is rarer still. Rather than leave the budget
// unspent, relax the cost and length quotas for the roles that are actually
// under-filled. A roster with two artillery is a roster where siege is not a
// strategy, and that is a worse outcome than a slightly heavy cost band.
for (const role of Object.keys(ROLE_SHARE)) {
  while ((have.role.get(role) ?? 0) < ROLE_QUOTA[role] && sprites < budget) {
    let best: Chain | undefined, bestScore = -1;
    for (const c of pool) {
      if (chosen.has(c) || c.role !== role) continue;
      if (sprites + weigh(c) > budget) continue;
      const s = score(c);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (!best) break;
    picked.push(best); chosen.add(best); take(best); sprites += weigh(best);
  }
}

const spriteCount = picked.reduce((a, c) => a + c.line.length, 0);
{
  const dropped = Object.keys(SPECIES).filter(isBase).filter((id) => excluded(id));
  const byReason = new Map<string, number>();
  for (const id of dropped) {
    const why = excluded(id)!.why;
    byReason.set(why, (byReason.get(why) ?? 0) + 1);
  }
  console.log(`excluded ${dropped.length} chains before selecting:`);
  for (const [why, n] of byReason) console.log(`  ${String(n).padStart(3)}  ${why}`);
  console.log();
}

console.log(`${picked.length} chains / ${spriteCount} sprites` +
  (dumpAll ? "  (every chain)" : `  (budget ${budget} ${unit})`) + "\n");

const tally = (m: Map<string | number, number>, label: string) => {
  const rows = [...m.entries()].sort((a, b) => Number(b[1]) - Number(a[1]));
  console.log(`  ${label}: ` + rows.map(([k, v]) => `${k} ${v}`).join("  "));
};
tally(have.role as Map<string|number,number>, "roles");
tally(have.cost as Map<string|number,number>, "costs");
tally(have.trait as Map<string|number,number>, "traits");
tally(have.len as Map<string|number,number>, "chain lengths");
console.log(`  types covered: ${have.type.size} of 18`);
console.log(`  already have art: ${picked.filter(c=>c.hasArt).length} chains ` +
  `(${picked.filter(c=>c.hasArt).reduce((a,c)=>a+c.line.length,0)} sprites)`);
console.log(`  need generating: ${picked.filter(c=>!c.hasArt).length} chains ` +
  `(${picked.filter(c=>!c.hasArt).reduce((a,c)=>a+c.line.length,0)} sprites)`);

console.log("\nTHE ROSTER\n");
for (const c of picked.sort((a, b) => a.cost - b.cost || a.role.localeCompare(b.role))) {
  const t = traitNames(c);
  console.log(
    `  ${String(c.cost).padStart(2)}  ${c.id.padEnd(15)} ${c.role.padEnd(11)}` +
    `${c.types.join("/").padEnd(22)} ${c.line.join(" > ").padEnd(42)}` +
    `${t.length ? t.join(",") : ""}${c.hasArt ? "" : "   [needs art]"}`,
  );
}
