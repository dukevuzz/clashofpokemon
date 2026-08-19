/** Which trades flip when you change a number. */

import { cards, tiers } from "../src/core/index.js";
import type { Card } from "../src/core/cards.js";
import { typeMultiplier } from "../src/core/species.js";

/** Seconds for `a` to kill `b`, or Infinity if it cannot. */
function timeToKill(a: Card, b: Card): number {
  const mult = typeMultiplier(a.sheet, b.sheet);
  const perHit = tiers.mitigate(a.damage * mult, b.def);
  if (perHit <= 0) return Infinity;
  const dps = (perHit / a.attackRate) * a.count;
  return (b.hp * b.count) / dps;
}

type Outcome = "win" | "lose" | "draw";

function trade(a: Card, b: Card): Outcome {
  const ta = timeToKill(a, b);
  const tb = timeToKill(b, a);
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return "draw";
  // Within 5% is a trade, not a win -- a margin that thin is decided by who
  // landed the first hit, which is placement, not the card.
  if (Math.abs(ta - tb) / Math.max(ta, tb) < 0.05) return "draw";
  return ta < tb ? "win" : "lose";
}

const roster = [...cards.ALL].sort((a, b) => a.elixir - b.elixir);
const [targetId, statName] = process.argv.slice(2);

// ------------------------------------------------------------- trade table

if (!targetId) {
  console.log("who beats whom, one on one (rows attack columns)\n");
  const short = (c: Card) => c.name.slice(0, 4);
  console.log("            " + roster.map(short).map((s) => s.padStart(5)).join(""));
  for (const a of roster) {
    const cells = roster.map((b) => {
      if (a === b) return "    ·";
      const r = trade(a, b);
      return (r === "win" ? "    W" : r === "lose" ? "    ." : "    =");
    });
    console.log(`  ${a.name.padEnd(10)}` + cells.join(""));
  }

  const wins = roster.map((a) => ({
    card: a,
    n: roster.filter((b) => a !== b && trade(a, b) === "win").length,
  })).sort((x, y) => y.n - x.n);

  console.log("\n  beats how many of the other 21, per elixir spent:");
  for (const { card, n } of wins) {
    console.log(
      `    ${card.name.padEnd(11)} ${String(n).padStart(2)}/21  cost ${card.elixir}` +
      `   ${(n / card.elixir).toFixed(1)} wins per elixir`,
    );
  }
  console.log(
    "\n  A card that beats nearly everything, or nearly nothing, is not a\n" +
    "  counter-web position -- it is a card with no conversation partners.",
  );
  process.exit(0);
}

// --------------------------------------------------------------- the sweep

const target = cards.byId(targetId);
if (!target) {
  console.log(`no card "${targetId}". try: ${roster.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const stat = (statName ?? "hp") as "hp" | "damage" | "speed" | "attackRate";
if (!["hp", "damage", "speed", "attackRate"].includes(stat)) {
  console.log(`stat must be one of: hp, damage, speed, attackRate`);
  process.exit(1);
}

const original = target[stat] as number;
console.log(`sweeping ${target.name} ${stat} (currently ${original})\n`);

// A copy, so the real card is never mutated -- other tools read cards.ALL.
const probe: Card = { ...target };
const others = roster.filter((c) => c.id !== target.id);
const baseline = new Map(others.map((b) => [b.id, trade(probe, b)]));

const flips: Array<{ pct: number; value: number; against: string; from: Outcome; to: Outcome }> = [];
let last = new Map(baseline);

for (let pct = -60; pct <= 60; pct += 1) {
  const value = original * (1 + pct / 100);
  (probe as unknown as Record<string, number>)[stat] = value;
  for (const b of others) {
    const now = trade(probe, b);
    const was = last.get(b.id)!;
    if (now !== was) {
      flips.push({ pct, value: Math.round(value), against: b.name, from: was, to: now });
      last.set(b.id, now);
    }
  }
}
(probe as unknown as Record<string, number>)[stat] = original;

if (flips.length === 0) {
  console.log("  nothing flips between -60% and +60%.");
  console.log("  Every change to this stat in that range is invisible in a one-on-one");
  console.log("  trade. If you are tuning it, you are tuning something else -- how long");
  console.log("  it survives a tower, or how much it soaks -- not what it beats.");
  process.exit(0);
}

console.log("  change   value   flips this trade");
for (const f of flips) {
  const dir = f.to === "win" ? "now BEATS" : f.to === "lose" ? "now loses to" : "now trades with";
  console.log(
    `  ${(f.pct > 0 ? "+" : "") + f.pct + "%"}`.padEnd(10) +
    `${String(f.value).padStart(6)}   ${dir} ${f.against}`,
  );
}

// The nearest flip in each direction is the change actually worth making.
const up = flips.filter((f) => f.pct > 0).sort((a, b) => a.pct - b.pct)[0];
const down = flips.filter((f) => f.pct < 0).sort((a, b) => b.pct - a.pct)[0];
console.log("\n  the smallest change that does anything:");
if (up) console.log(`    buff  +${up.pct}%  (${original} -> ${up.value})  ${up.to === "win" ? "beats" : "vs"} ${up.against}`);
if (down) console.log(`    nerf  ${down.pct}%  (${original} -> ${down.value})  ${down.to === "lose" ? "loses to" : "vs"} ${down.against}`);
console.log(
  "\n  Anything smaller than these moves a number without changing an outcome.\n" +
  "  That is the definition of an invisible nerf.",
);
