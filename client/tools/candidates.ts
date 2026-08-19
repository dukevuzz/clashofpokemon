/** Roster candidates: what we could add, and whether we can actually ship it. */
import fs from "node:fs";
import path from "node:path";
import { SPECIES } from "../src/core/species.js";
import * as evolution from "../src/core/evolution.js";
import { ROSTER } from "../src/core/roster.js";
import { costOf } from "../src/core/pricing.js";

const PAC = process.env.PAC ?? "../../pokemonAutoChess";
const want = Number(process.argv[2] ?? 150);

const enumSrc = fs.readFileSync(path.join(PAC, "app/types/enum/Pokemon.ts"), "utf8");
const index = new Map<string, string>();
for (const m of enumSrc.matchAll(/\[Pkm\.([A-Z0-9_]+)\]:\s*"([0-9-]+)"/g)) {
  index.set(m[1].toLowerCase(), m[2]);
}
const assetDir = path.join(PAC, "app/public/src/assets/pokemons");
const sheets = new Set(
  fs.readdirSync(assetDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));

const animSrc = fs.readFileSync(
  path.join(PAC, "app/public/src/game/components/pokemon-animations.ts"), "utf8");
const declaredAttack = new Map<string, string>();
for (const m of animSrc.matchAll(/\[Pkm\.([A-Z0-9_]+)\]:\s*\{(.*?)\n  \}/gs)) {
  const a = /attack:\s*AnimationType\.(\w+)/.exec(m[2]);
  if (a) declaredAttack.set(m[1].toLowerCase(), a[1]);
}

/** Art exists, and something in it can be played as an attack. */
function shippable(species: string): boolean {
  const i = index.get(species);
  if (!i || !sheets.has(i)) return false;
  const raw = fs.readFileSync(path.join(assetDir, `${i}.json`), "utf8");
  const declared = declaredAttack.get(species);
  return raw.includes("/Attack/") || raw.includes("/Shoot/")
    || (declared ? raw.includes(`/${declared}/`) : false);
}

// Competitive usage, most-played first. Eternatus and Eternal Flower Floette
// are left out deliberately: both are event/format exclusives.
const VGC = `kingambit basculegion garchomp sneasler charizard incineroar sinistcha
whimsicott froslass aerodactyl sylveon scovillain dragonite farigiraf archaludon
delphox venusaur tyranitar corviknight gengar pelipper vivillon maushold talonflame
politoed blastoise glimmora hydreigon palafin ceruledge excadrill milotic espathra
gardevoir aegislash kommoo kangaskhan scizor toxapex gyarados torkoal sableye
mimikyu mamoswine camerupt kleavor volcarona steelix tinkaton lopunny weavile
tsareena skarmory snorlax dragapult orthworm empoleon crabominable clefable
chandelure azumarill primarina manectric serperior arcanine araquanid gallade
abomasnow lucario heracross oranguru starmie armarouge`.split(/\s+/).filter(Boolean);

const TOP_TIERS = new Set(["legendary", "mythical"]);
const all = SPECIES as never as Record<string, { rarity: string }>;

const seed: { id: string; why: string }[] = [];
for (const n of VGC) if (all[n]) seed.push({ id: n, why: "vgc" });
for (const [id, info] of Object.entries(all)) {
  if (TOP_TIERS.has(info.rarity)) seed.push({ id, why: info.rarity });
}

const onRoster = new Set(ROSTER);
const chains = new Map<string, { line: string[]; why: string; rarity: string }>();
for (const { id, why } of seed) {
  if (/eternatus|eternalflower/.test(id)) continue;
  const line = evolution.lineOf(id) ?? [id];
  const base = line[0];
  if (onRoster.has(base) || chains.has(base)) continue;
  if (!line.every(shippable)) continue;
  chains.set(base, { line, why, rarity: all[base]?.rarity ?? "?" });
}

// VGC first -- a creature people actually play beats one that is merely rare.
const order = ["vgc", "legendary", "mythical"];
const ranked = [...chains].sort((a, b) => {
  const d = order.indexOf(a[1].why) - order.indexOf(b[1].why);
  if (d) return d;
  return VGC.indexOf(a[0]) - VGC.indexOf(b[0]);
}).slice(0, want);

console.log(`${chains.size} shippable chains available; showing ${ranked.length}\n`);
let group = "";
for (const [base, c] of ranked) {
  if (c.why !== group) { group = c.why; console.log(`\n--- ${group.toUpperCase()} ---`); }
  const info = all[base];
  const cost = info ? costOf(info as never, info.rarity, 1, {}) : "?";
  const top = c.line[c.line.length - 1];
  const end = all[top] ? costOf(all[top] as never, all[top].rarity, 1, {}) : "?";
  console.log(`  ${base.padEnd(14)} ${cost} -> ${end}  ${c.rarity.padEnd(10)} ${c.line.join(" -> ")}`);
}
