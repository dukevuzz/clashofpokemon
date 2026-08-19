/** What did a change actually do to the roster? */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { cards } from "../src/core/index.js";
import { config } from "../src/core/config.js";

const BASELINE = new URL("../balance-baseline.json", import.meta.url).pathname;

interface Snapshot {
  takenAt: string | null;
  towerHP: { side: number; king: number };
  towerDamage: { side: number; king: number };
  /** Everything else about the match that a balance change can touch. */
  rules: Record<string, number>;
  cards: Record<string, { elixir: number; hp: number; damage: number; speed: number; range: number; count: number }>;
}

/** Every number anywhere in config, as `a.b.c` keys. */
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") out[path] = value;
    else if (Array.isArray(value)) {
      value.forEach((v, i) => { if (typeof v === "number") out[`${path}[${i}]`] = v; });
    } else if (value && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, path));
    }
  }
  return out;
}

function snapshot(): Snapshot {
  return {
    takenAt: null, // stamped by the caller; the sim must stay deterministic
    towerHP: { ...config.towerHP },
    towerDamage: { ...config.towerDamage },
    rules: flatten(config as unknown as Record<string, unknown>),
    cards: Object.fromEntries(
      cards.ALL.map((c) => [
        c.id,
        {
          elixir: c.elixir, hp: c.hp, damage: c.damage,
          speed: Math.round(c.speed), range: c.range, count: c.count,
        },
      ]),
    ),
  };
}

/** Where a change of this size sits in the 2025 Clash Royale record. */
function verdict(pct: number): string {
  const m = Math.abs(pct);
  if (m === 0) return "";
  if (m <= 8) return "small      (below their 25th pct)";
  if (m <= 15) return "normal     (their median is 12%)";
  if (m <= 29) return "large      (their 75th pct is 29%)";
  if (m <= 50) return "very large (their 90th pct is 50%)";
  return "OFF THE SCALE -- structural, or a guess";
}

const mode = process.argv[2] ?? "diff";

if (mode === "snapshot") {
  writeFileSync(BASELINE, JSON.stringify(snapshot(), null, 2));
  console.log(`baseline written: ${cards.ALL.length} cards`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log("no baseline. run `npm run balance:snapshot` first, then make a change.");
  process.exit(1);
}

const before = JSON.parse(readFileSync(BASELINE, "utf8")) as Snapshot;
const after = snapshot();

const pct = (a: number, b: number) => (a === 0 ? (b === 0 ? 0 : 100) : ((b - a) / a) * 100);
const rows: Array<{ what: string; from: number; to: number; change: number }> = [];

for (const [key, a] of Object.entries(before.rules ?? {})) {
  const b = after.rules[key];
  if (b !== undefined && a !== b) rows.push({ what: key, from: a, to: b, change: pct(a, b) });
}

const gone: string[] = [];
for (const [id, a] of Object.entries(before.cards)) {
  const b = after.cards[id];
  if (!b) { gone.push(id); continue; }
  for (const stat of ["elixir", "hp", "damage", "speed", "range", "count"] as const) {
    if (a[stat] !== b[stat]) {
      rows.push({ what: `${id} ${stat}`, from: a[stat], to: b[stat], change: pct(a[stat], b[stat]) });
    }
  }
}
const added = Object.keys(after.cards).filter((id) => !before.cards[id]);

if (rows.length === 0 && !added.length && !gone.length) {
  console.log("nothing changed since the baseline.");
  process.exit(0);
}

console.log(`${rows.length} stat changes across ${new Set(rows.map(r => r.what.split(" ")[0])).size} things\n`);
console.log("what                        from      to    change   against the 2025 CR record");
for (const r of rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))) {
  const arrow = r.change > 0 ? "+" : "";
  console.log(
    `  ${r.what.padEnd(24)} ${String(r.from).padStart(6)} ${String(r.to).padStart(6)}` +
    `  ${(arrow + r.change.toFixed(0) + "%").padStart(7)}   ${verdict(r.change)}`,
  );
}
if (added.length) console.log(`\n  added:   ${added.join(", ")}`);
if (gone.length) console.log(`  removed: ${gone.join(", ")}`);

// The thing that actually goes wrong: a formula edit moving forty stats at once.
const touched = new Set(rows.map((r) => r.what.split(" ")[0]));
console.log(
  `\n  ${touched.size} of ${cards.ALL.length + 2} things moved. ` +
  (touched.size > 8
    ? "Clash Royale caps a patch at 10-24 CARDS; this is a formula change, so\n" +
      "  it moved everything at once. That is the risk of derived stats -- there is\n" +
      "  no diff to review unless you generate one. Re-simulate before believing it."
    : "Within a normal patch's blast radius."),
);
