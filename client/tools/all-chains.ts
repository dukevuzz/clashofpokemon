/** Every evolution chain in the data, as one reference table. */

import { SPECIES, typesOf } from "../src/core/species.js";
import * as tiers from "../src/core/tiers.js";
import * as cards from "../src/core/cards.js";
import * as evolution from "../src/core/evolution.js";
import { towerRange } from "../src/core/config.js";
import { SHEETS } from "../src/data/sheets.js";

const isBase = (id: string) =>
  !Object.keys(SPECIES).some((o) => evolution.nextOf(o) === id);

const rows = Object.keys(SPECIES).filter(isBase).map((id) => {
  const info = SPECIES[id];
  const role = tiers.roleOf(id);
  const types = typesOf(id);
  const flying = types.includes("FLYING");
  const traits = tiers.traitsOf(id, towerRange());
  const line = evolution.lineOf(id);
  const tags: string[] = [];
  if (traits.wincon) tags.push("wincon");
  if (traits.jumpsRiver) tags.push("jumps");
  if (flying) tags.push("air");
  if (traits.static) tags.push("building");
  if (traits.trueDamage) tags.push("true");
  if (evolution.BRANCHES[id]) tags.push(`branches x${evolution.BRANCHES[id].length}`);
  const ability = tiers.abilityOf(info.skill);
  return {
    id, line, role, types, tags, rarity: tiers.rarityOf(id),
    cost: cards.costOf(info, tiers.rarityOf(id), 1,
      { wincon: traits.wincon, jumps: traits.jumpsRiver, flying }),
    hp: info.hp, atk: info.atk, def: info.def, speed: info.speed,
    skill: info.skill,
    dmg: ability ? `${ability.damage.join("/")} ${ability.attackType.toLowerCase()}` : "",
    art: line.filter((f) => SHEETS[f]).length,
    len: line.length,
  };
});

if (process.argv[2] === "csv") {
  console.log("base,forms,chain,cost,role,rarity,types,traits,hp,atk,def,speed,skill,ability_damage,sprites_have,sprites_need");
  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log([
      r.id, r.len, r.line.join(">"), r.cost, r.role, r.rarity,
      r.types.join("/"), r.tags.join(" "), r.hp, r.atk, r.def, r.speed,
      r.skill, r.dmg, r.art, r.len - r.art,
    ].map((x) => `"${x}"`).join(","));
  }
} else {
  const terminal = rows.filter((r) => r.len === 1);
  console.log(`${rows.length} chains from ${Object.keys(SPECIES).length} species\n`);
  console.log(`  ${terminal.length} have NO evolution (${(100*terminal.length/rows.length).toFixed(0)}%)`);
  console.log(`  ${rows.length - terminal.length} do evolve`);
  console.log(`  ${rows.filter(r => r.art === r.len).length} are fully sprited today\n`);

  for (const len of [1, 2, 3, 4]) {
    const group = rows.filter((r) => r.len === len).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
    if (!group.length) continue;
    console.log(`\n${"=".repeat(78)}\n${len} FORM${len > 1 ? "S" : ""} — ${group.length} chains` +
      (len === 1 ? "   (terminal: plays as-is, never grows)" : "") + `\n${"=".repeat(78)}`);
    for (const r of group) {
      console.log(
        `  ${String(r.cost).padStart(2)} ${r.id.padEnd(22)} ${r.role.padEnd(11)}` +
        `${r.rarity.padEnd(10)} ${r.types.join("/").padEnd(20)} ` +
        `hp${String(r.hp).padStart(4)} atk${String(r.atk).padStart(3)} spd${String(r.speed).padStart(3)}  ` +
        `${(r.art === r.len ? "ART" : `${r.art}/${r.len}`).padEnd(5)}` +
        `${r.tags.join(",")}`,
      );
      if (len > 1) console.log(`     ${r.line.join(" > ")}`);
    }
  }
}
