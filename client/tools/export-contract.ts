/** Every message on the wire, in both directions, as the client declares them. */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  PROTOCOL_VERSION, TICK_HZ, SNAP_HZ, INVITE_LENGTH, ACTIONS, STATUS_BITS,
  type ClientMessage, type ServerMessage,
} from "../src/net/protocol.js";

const OUT = "../../server/src/test/resources/contract.json";

/** Everything a player can say. The whole vocabulary. */
const FROM_CLIENT: ClientMessage[] = [
  { t: "auth", ticket: "a.signed.ticket", deck: ["charmander"], troop: "togekiss" },
  { t: "auth", ticket: "a.signed.ticket", deck: ["charmander"], troop: "togekiss",
    branch: "espeon" },
  { t: "auth", ticket: "a.signed.ticket", deck: ["charmander"], troop: "togekiss",
    invite: { create: true } },
  { t: "auth", ticket: "a.signed.ticket", deck: ["charmander"], troop: "togekiss",
    invite: { code: "ABCDE" } },
  { t: "loaded" },
  { t: "deploy", seq: 1, slot: 0, x: 144, y: 560 },
  { t: "deploy", seq: 2, slot: 1, x: 144, y: 560, form: "deoxysattack" },
  { t: "choose", seq: 3, choiceId: "c1", cardId: "espeon" },
  { t: "leave" },
  { t: "ping", c: 1700000000000 },
];

/** Everything the server can say back. */
const FROM_SERVER: ServerMessage[] = [
  {
    t: "hello", v: PROTOCOL_VERSION, matchId: "m_abc", you: "acct_1", seat: 1,
    tick: TICK_HZ, snap: SNAP_HZ,
    me: { deck: ["charmander"], troop: "togekiss" },
    them: { id: "acct_2", name: "Bo", deck: ["squirtle"], troop: "togekiss" },
  },
  { t: "start", seed: 12345, startedAt: 1700000000000 },
  { t: "invite", code: "ABCDE" },
  {
    t: "snap", tick: 30, left: 178.5,
    u: [[1, 100.5, 500.5, 156, 0, 0, 4, 0, 0]],
    w: [[7, 546, 1, 0, 0]],
    p: [[120.5, 480.5]],
    me: { e: 5.5, hand: ["charmander", null, "squirtle", "machop"], next: "geodude" },
  },
  { t: "ev", tick: 30, e: [{ e: "ready", id: 1 }] },
  { t: "over", result: "player", youWon: true },
  { t: "reject", seq: 1, code: "elixir" },
  { t: "peer", state: "disconnected" },
  { t: "pong", c: 1700000000000, tick: 30 },
  { t: "error", message: "auth first" },
];

const shapeOf = (m: { t: string }) => ({
  t: m.t,
  fields: Object.keys(m).sort(),
  example: m,
});

const out = {
  version: PROTOCOL_VERSION,
  tickHz: TICK_HZ,
  snapHz: SNAP_HZ,
  inviteLength: INVITE_LENGTH,
  actions: [...ACTIONS],
  statusBits: [...STATUS_BITS],
  /** Refusal codes, which the client shows a different message for. */
  rejectCodes: ["elixir", "slot", "zone", "stale", "rate", "over", "notstarted"],
  fromClient: FROM_CLIENT.map(shapeOf),
  fromServer: FROM_SERVER.map(shapeOf),
};

const path = new URL(OUT, import.meta.url);
mkdirSync(dirname(path.pathname), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");

console.log("contract.json");
console.log(`  ${out.fromClient.length} client messages, ${out.fromServer.length} server`);
for (const m of out.fromServer) console.log(`  <- ${m.t.padEnd(7)} ${m.fields.join(" ")}`);
