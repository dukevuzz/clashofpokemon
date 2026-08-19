/** The wire, byte for byte, as the TypeScript writes it. */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encodeSnap, type SnapData } from "../src/net/binary.js";
import { CARD_TABLE, contentHash } from "../src/core/cardTable.js";
import { statusBits, ACTIONS } from "../src/net/protocol.js";
import { config } from "../src/core/config.js";

const OUT = "../../server/src/test/resources/wire.json";

const cases: Array<{ name: string; snap: SnapData }> = [
  {
    name: "an empty board, before anything is played",
    snap: {
      tick: 0, left: config.matchSeconds, u: [], w: [], p: [],
      me: { e: config.startElixir, hand: [null, null, null, null], next: null },
    },
  },
  {
    name: "one creature, one tower, one shot",
    snap: {
      tick: 1, left: 179.5,
      u: [[1, 100.5, 500.25, 156, 0, ACTIONS.indexOf("Walk"), 4, 0, 0]],
      w: [[7, 546, 1, 0, 0]],
      p: [[120.5, 480.5]],
      me: { e: 5.5, hand: ["charmander", "squirtle", null, "machop"], next: "geodude" },
    },
  },
  {
    name: "the far corner, the largest health, every status at once",
    snap: {
      tick: 0xffffff, left: 0,
      u: [[
        0xffff, config.arenaWidth, config.arenaHeight, 2402, 65535,
        ACTIONS.indexOf("Shoot"), 7, 25.5,
        statusBits(["paralysis", "flinch", "confusion", "armorBreak",
                    "burn", "poison", "sleep"]),
      ]],
      w: [[1, 2402, 1, 25.5, 255]],
      p: [[0, 0]],
      me: { e: config.elixirMax, hand: [CARD_TABLE[0], CARD_TABLE[CARD_TABLE.length - 1]],
            next: CARD_TABLE[1] },
    },
  },
  {
    name: "values that must be clamped rather than wrapped",
    snap: {
      tick: 12345, left: -5,
      u: [[3, -10.04, 900.06, -20, -1, 1, 0, 99, 0]],
      w: [[2, -1, 0, 99, 999]],
      p: [],
      me: { e: -1, hand: [], next: null },
    },
  },
  {
    name: "a crowded board, to fix the size arithmetic",
    snap: {
      tick: 5400, left: 12.3,
      u: Array.from({ length: 40 }, (_, i) =>
        [i + 1, i * 9, 672 - i * 16, 300 - i, i, i % 4, i % 8, 0, i % 128] as
          SnapData["u"][number]),
      w: Array.from({ length: 6 }, (_, i) => [i + 1, 500 + i, 1, 0, 0] as
        SnapData["w"][number]),
      p: Array.from({ length: 12 }, (_, i) => [i * 7.5, i * 11.25] as
        SnapData["p"][number]),
      me: { e: 7.77, hand: ["ditto", null, "eevee", "pikachu"], next: "snorlax" },
    },
  },
];

const out = {
  contentHash,
  cardTable: { size: CARD_TABLE.length, first: CARD_TABLE[0],
               last: CARD_TABLE[CARD_TABLE.length - 1] },
  cases: cases.map((c) => ({
    name: c.name,
    snap: c.snap,
    // Hex rather than base64: a failing test prints a diff somebody can read
    // against the field widths in the comment above.
    bytes: Buffer.from(encodeSnap(c.snap)).toString("hex"),
  })),
};

const path = new URL(OUT, import.meta.url);
mkdirSync(dirname(path.pathname), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");

console.log("wire.json");
console.log(`  content hash ${contentHash}, ${CARD_TABLE.length} cards`);
for (const c of out.cases) console.log(`  ${c.bytes.length / 2} bytes  ${c.name}`);
