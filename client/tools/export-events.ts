/** The shape of every event, as the client declares it. */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WireEvent } from "../src/net/protocol.js";

const OUT = "../../server/src/test/resources/events.json";

/** One of each, with values chosen only to be obviously distinguishable. */
const EVERY_EVENT: WireEvent[] = [
  { e: "spawn", id: 1, card: "charmander", side: 1, lane: 0, x: 100.5, y: 500.5, arrive: 0.5 },
  { e: "ready", id: 1 },
  { e: "hit", id: 2, amount: 42, mult: 2, from: 1 },
  { e: "cast", id: 1, skill: "EMBER", at: 2 },
  { e: "status", id: 2, kind: "burn", seconds: 3.5 },
  { e: "shot", from: 1, to: 2, amount: 12, mult: 1.5 },
  { e: "death", id: 2, tower: false },
  { e: "towerDown", id: 7 },
  { e: "kingWakes", id: 9 },
  { e: "evolve", side: 1, from: "charmander", to: "charmeleon" },
  { e: "choice", side: 2, id: "c1", from: "eevee", options: ["espeon", "umbreon"] },
  { e: "over", result: "player" },
];

const out = {
  events: EVERY_EVENT.map((event) => ({
    kind: event.e,
    // Sorted, so the comparison is about which fields exist rather than the
    // order a literal happened to be written in.
    fields: Object.keys(event).sort(),
    example: event,
  })),
};

const path = new URL(OUT, import.meta.url);
mkdirSync(dirname(path.pathname), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");

console.log("events.json");
for (const e of out.events) console.log(`  ${e.kind.padEnd(10)} ${e.fields.join(" ")}`);
