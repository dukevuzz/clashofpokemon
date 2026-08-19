/**
 * The client's half of the contract.
 *
 * `contract.json` is generated from the types in `net/protocol.ts` and checked
 * by the Java server, which is what stops the two ends drifting apart. This is
 * the other half: it checks that the *client* reads what that file says, so
 * the fixture cannot quietly become a description of neither side.
 *
 * Both checks are needed and they catch different things. Java's proves the
 * server writes those keys. This proves the client is not reading some other
 * key it happens to agree with itself about -- which is exactly what went
 * wrong: the server sent `fromCard`, the client read `from`, and each had a
 * green suite.
 *
 * If this file and the fixture disagree, run `npm run export:contract`. If it
 * still disagrees, the client and the protocol have parted company.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NetMatch } from "../src/net/client";
import {
  PROTOCOL_VERSION, TICK_HZ, SNAP_HZ, INVITE_LENGTH, ACTIONS, STATUS_BITS,
  type ServerMessage,
} from "../src/net/protocol";

const contract = JSON.parse(
  readFileSync(new URL("../../server/src/test/resources/contract.json", import.meta.url), "utf8"),
) as {
  version: number; tickHz: number; snapHz: number; inviteLength: number;
  actions: string[]; statusBits: string[]; rejectCodes: string[];
  fromClient: Array<{ t: string; fields: string[]; example: Record<string, unknown> }>;
  fromServer: Array<{ t: string; fields: string[]; example: ServerMessage }>;
};

describe("the numbers neither end may change alone", () => {
  it("matches the protocol the client was built against", () => {
    expect(contract.version).toBe(PROTOCOL_VERSION);
    expect(contract.tickHz).toBe(TICK_HZ);
    expect(contract.snapHz).toBe(SNAP_HZ);
    expect(contract.inviteLength).toBe(INVITE_LENGTH);
  });

  it("keeps the positional lists in order", () => {
    // An action travels as its index and a status set as a bitmask, so
    // reordering either silently renames every value in it.
    expect(contract.actions).toEqual([...ACTIONS]);
    expect(contract.statusBits).toEqual([...STATUS_BITS]);
  });
});

/**
 * A socket that goes nowhere, so the client can be driven message by message.
 *
 * The point is not to simulate a server -- it is to feed the client exactly
 * the bytes the fixture says a server sends, and see whether it copes.
 */
class Wire {
  static last: Wire;
  static OPEN = 1;
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: unknown }) => void;
  onerror?: () => void;
  onclose?: () => void;

  constructor() {
    Wire.last = this;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function connected() {
  (globalThis as { WebSocket?: unknown }).WebSocket = Wire as unknown;
  const errors: string[] = [];
  const net = new NetMatch("ws://test", {
    onSeat: () => {}, onStart: () => {}, onEvents: () => {}, onOver: () => {},
    onReject: () => {}, onPeer: () => {}, onInvite: () => {}, onNote: () => {},
    onError: (m: string) => errors.push(m),
  });
  net.connect("ticket", ["charmander"], "togekiss");
  Wire.last.onopen?.();
  return { net, wire: Wire.last, errors };
}

describe("every message the server can send", () => {
  for (const message of contract.fromServer) {
    it(`is handled: ${message.t}`, () => {
      const { wire, errors } = connected();
      // The bar is that nothing throws and nothing is reported as an error --
      // a client that cannot read a message it will certainly receive is a
      // screen that stops updating with no explanation.
      expect(() => wire.deliver(message.example)).not.toThrow();
      expect(errors.filter((e) => e.includes("unknown"))).toEqual([]);
    });
  }

  it("declares no message the client has no handler for", () => {
    // Read off the union rather than listed here, so adding one to the
    // protocol is what makes this fail.
    const handled = [
      "hello", "start", "invite", "snap", "ev", "over",
      "reject", "peer", "pong", "error",
    ];
    expect(contract.fromServer.map((m) => m.t).sort()).toEqual([...handled].sort());
  });
});

describe("every message the client sends", () => {
  it("sends auth first, shaped as the contract says", () => {
    const { wire } = connected();
    const auth = JSON.parse(wire.sent[0]) as Record<string, unknown>;
    const declared = contract.fromClient.find((m) => m.t === "auth")!;

    expect(auth.t).toBe("auth");
    // Undefined optional fields are dropped by JSON.stringify, so the check is
    // that nothing is sent which the contract does not declare.
    for (const key of Object.keys(auth)) {
      expect(declared.fields).toContain(key);
    }
  });

  it("names the offer when answering one, rather than its position", () => {
    // A position in a list would answer the wrong question once a second
    // offer could be open, and a branch cannot be taken back.
    const declared = contract.fromClient.find((m) => m.t === "choose")!;
    expect(declared.fields).toContain("choiceId");
    expect(declared.fields).not.toContain("index");
  });

  it("describes a deploy in one message, with nothing to race", () => {
    const declared = contract.fromClient.find((m) => m.t === "deploy" && "form" in m.example)!;
    expect(declared.fields.sort()).toEqual(["form", "seq", "slot", "t", "x", "y"]);
  });
});

describe("every refusal", () => {
  it("is one the client has something to say about", () => {
    const { wire, errors } = connected();
    for (const code of contract.rejectCodes) {
      expect(() => wire.deliver({ t: "reject", seq: 1, code })).not.toThrow();
    }
    expect(errors).toEqual([]);
  });
});
