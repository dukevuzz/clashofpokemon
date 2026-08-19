/**
 * A per-step fingerprint of one match, for finding where two engines part.
 *
 * The differential suite compares blows and checkpoints, which tells you that
 * the engines disagree but not where it started -- and by the time a blow
 * differs, the cause is thousands of frames upstream. This writes a digest of
 * every unit's exact position at every step, so the Java side can say "step
 * 1417, unit 9, x differs in the last bit" instead of "one blow is missing".
 *
 *   npx tsx tools/export-trace.ts <fixtureIndex>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Match } from "../src/core/match";
import { config } from "../src/core/config";
import * as cards from "../src/core/cards";

const IN = new URL("../../server/src/test/resources/differential.json", import.meta.url);
const OUT = new URL("../../server/src/test/resources/trace.json", import.meta.url);

const index = Number(process.argv[2] ?? 0);
const fixture = JSON.parse(readFileSync(IN, "utf8")).matches[index];

const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const bits = (n: number) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, n);
  return b.getBigUint64(0).toString(16);
};

const rng = seeded(fixture.seed);
const deck = (ids: string[]) => ids.map((id) => cards.byId(id)!);
const match = new Match({
  playerDeck: deck(fixture.deckOne), enemyDeck: deck(fixture.deckTwo),
  rng, shuffle: false,
});

const plays: any[] = fixture.plays;
let next = 0;
const steps: string[] = [];

for (let step = 0; step < config.matchSeconds * 30 + 60 && !match.over; step++) {
  while (next < plays.length && plays[next].step === step) {
    const p = plays[next++];
    match.deploy(p.side, p.slot, p.x, p.y, p.form ?? undefined);
  }
  match.update(1 / 30);
  // Exact bits, so a difference of one ulp is visible.
  // Towers and shots too. The first visible difference was a unit's health
  // with everything about that unit identical -- so whatever caused it was in
  // state the fingerprint did not cover.
  const towers = match.towers.map((t) =>
    `${t.id}:${bits(t.hp)}:${bits(t.cooldown)}:${bits(t.reloading ?? 0)}:${t.ammo ?? 0}:${bits(t.waking ?? 0)}:${t.active ? 1 : 0}:${t.dead ? 1 : 0}`
  ).join("|");
  const shots = match.projectiles.map((p) =>
    `${bits(p.x)}:${bits(p.y)}:${bits(p.amount)}:${p.target.id}`
  ).join("|");

  steps.push(towers + "#" + shots + "#" + match.units.map((u) =>
    `${u.id}:${bits(u.x)}:${bits(u.y)}:${bits(u.hp)}:${bits(u.cooldown)}:${u.target ? (u.target.isTower ? "T" + u.target.id : "U" + u.target.id) : "-"}:${bits(u.charge)}:${bits(u.spawning)}:${u.dead ? 1 : 0}`
  ).join("|"));
}

writeFileSync(OUT, JSON.stringify({ index, seed: fixture.seed, steps }, null, 0) + "\n");
console.log(`trace.json  match[${index}] seed ${fixture.seed}, ${steps.length} steps`);
