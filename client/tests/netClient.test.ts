/**
 * What the client does with what the server says.
 *
 * Covered end to end by two real browsers, and that is the wrong place to
 * catch the bugs this code actually has. Applying a snapshot is index
 * arithmetic over nine-field tuples; getting one wrong does not throw, it puts
 * a creature in the wrong place or the wrong card in your hand, and the
 * browser test would pass while the game quietly lied.
 *
 * So: a fake socket, hand-built messages, and assertions about the Match the
 * renderer will read.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NetMatch } from "../src/net/client";
import { statusBits, bitsToStatus, ACTIONS, type WireEvent } from "../src/net/protocol";
import { encodeSnap } from "../src/net/binary";
import { laneOpen, nearestDeploy, canDeploy } from "../src/core/deploy";
import { forwardFor } from "../src/core/config";
import { config } from "../src/core/config";
import { byId } from "../src/core/cards";

/**
 * Enough WebSocket to satisfy the client.
 *
 * `NetMatch` reaches for the global, so the global is what gets replaced. The
 * alternative -- injecting a socket factory -- would be a seam that exists
 * only for tests, on a class whose whole job is to own one socket.
 */
class FakeSocket {
  static last: FakeSocket;
  static OPEN = 1;
  readyState = 1;
  binaryType = "";
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: unknown }) => void;
  onerror?: () => void;
  onclose?: () => void;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  /** Deliver a server message, as a text frame. */
  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Deliver a packed snapshot, as a binary frame. */
  deliverBinary(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.buffer.slice(0) });
  }
}

const HELLO = {
  t: "hello", v: 1, matchId: "m_test", you: "acct_me", seat: config.ENEMY,
  tick: 30, snap: 15,
  me: { deck: ["charmander", "snorlax", "voltorb", "machop", "geodude", "eevee"],
        troop: "togekiss" },
  them: { id: "acct_them", name: "Ember101",
          deck: ["pikachu", "onix", "ditto", "yamper", "grimer", "bronzor"],
          troop: "crobat" },
};

const spawn = (over: Partial<Extract<WireEvent, { e: "spawn" }>> = {}) => ({
  e: "spawn" as const, id: 17, card: "charmander", side: config.ENEMY,
  lane: 0, x: 100, y: 500, arrive: 0.8, ...over,
});

function connected() {
  const seen: WireEvent[][] = [];
  const notes: string[] = [];
  const net = new NetMatch("ws://test", {
    onSeat: () => {}, onStart: () => {},
    onEvents: (e) => seen.push(e),
    onOver: () => {}, onReject: () => {}, onPeer: () => {},
    onError: () => {}, onNote: (t) => notes.push(t),
  });
  net.connect("tkt", HELLO.me.deck, "togekiss");
  FakeSocket.last.onopen?.();
  FakeSocket.last.deliver(HELLO);
  return { net, socket: FakeSocket.last, seen, notes };
}

beforeEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
});

describe("the handshake", () => {
  it("takes the seat the server dealt", () => {
    const { net } = connected();
    expect(net.seat).toBe(config.ENEMY);
    expect(net.them).toBe(config.PLAYER);
    expect(net.matchId).toBe("m_test");
  });

  it("learns both decks, because the art loader needs them", () => {
    // Decks arrive in the handshake rather than at `start`, and that ordering
    // is not cosmetic: `start` waits for both clients to report loaded, and a
    // client cannot load what it has not been told about.
    const { net } = connected();
    expect(net.match.deck[net.seat].map((c) => c.id)).toEqual(HELLO.me.deck);
    expect(net.match.deck[net.them].map((c) => c.id)).toEqual(HELLO.them.deck);
  });

  it("zeroes the opponent's elixir rather than leaving a plausible lie", () => {
    // The server never sends it. Five -- the local Match's starting value -- is
    // a believable number, and a believable wrong number is the kind that gets
    // drawn by accident and trusted.
    const { net } = connected();
    expect(net.match.elixir[net.them]).toBe(0);
  });

  it("sends the auth message first, with the deck", () => {
    const { socket } = connected();
    const first = JSON.parse(socket.sent[0]) as { t: string; deck: string[] };
    expect(first.t).toBe("auth");
    expect(first.deck).toEqual(HELLO.me.deck);
  });
});

describe("applying a snapshot", () => {
  const snapFor = (units: number[][], over: Record<string, unknown> = {}) => ({
    t: "snap", tick: 10, left: 170.5,
    u: units, w: [], p: [],
    me: { e: 6.5, hand: ["charmander", null, "voltorb", "machop"], next: "geodude" },
    ...over,
  });

  it("moves a unit the spawn event created", () => {
    const { net } = connected();
    net.onEvents = (events) => {
      for (const e of events) net.rehydrate(e);
    };
    FakeSocket.last.deliver({ t: "ev", tick: 1, e: [spawn()] });
    FakeSocket.last.deliver(snapFor([[17, 123.4, 456.7, 210, 5, 0, 4, 0, 0]]));

    const unit = net.match.units.find((u) => u.id === 17)!;
    expect(unit.x).toBeCloseTo(123.4, 1);
    expect(unit.y).toBeCloseTo(456.7, 1);
    expect(unit.hp).toBe(210);
    expect(unit.shield).toBe(5);
    expect(unit.action).toBe("Walk");
  });

  it("ignores a unit whose spawn has not arrived", () => {
    // Snapshots and events are separate messages and can cross. Inventing a
    // unit from a snapshot would mean guessing its card.
    const { net } = connected();
    FakeSocket.last.deliver(snapFor([[99, 10, 10, 100, 0, 0, 0, 0, 0]]));
    expect(net.match.units).toHaveLength(0);
  });

  it("drops anything the server stopped listing", () => {
    const { net } = connected();
    net.onEvents = (events) => { for (const e of events) net.rehydrate(e); };
    FakeSocket.last.deliver({ t: "ev", tick: 1, e: [spawn(), spawn({ id: 18 })] });
    FakeSocket.last.deliver(snapFor([
      [17, 1, 1, 100, 0, 0, 0, 0, 0], [18, 2, 2, 100, 0, 0, 0, 0, 0],
    ]));
    expect(net.match.units).toHaveLength(2);

    // 18 died, or walked off. Either way the snapshot is the authority.
    FakeSocket.last.deliver(snapFor([[17, 1, 1, 100, 0, 0, 0, 0, 0]], { tick: 11 }));
    expect(net.match.units.map((u) => u.id)).toEqual([17]);
  });

  it("takes the clock and the hand from the server", () => {
    const { net } = connected();
    FakeSocket.last.deliver(snapFor([]));
    expect(net.match.time).toBe(170.5);
    expect(net.match.elixir[net.seat]).toBe(6.5);
    expect(net.match.hand[net.seat].map((c) => c?.id))
      .toEqual(["charmander", undefined, "voltorb", "machop"]);
  });

  it("refuses a snapshot older than one already applied", () => {
    // UDP-like reordering does not happen on a socket, but a reconnect can
    // deliver a resync after a newer live snapshot. The newer one wins.
    const { net } = connected();
    FakeSocket.last.deliver(snapFor([], { tick: 50, left: 100 }));
    FakeSocket.last.deliver(snapFor([], { tick: 20, left: 160 }));
    expect(net.match.time).toBe(100);
  });

  it("reads a packed snapshot the same as a JSON one", () => {
    const { net } = connected();
    const packed = encodeSnap({
      tick: 5, left: 42.5,
      u: [], w: [], p: [[1, 2]],
      me: { e: 3.25, hand: ["snorlax", null, null, null], next: null },
    });
    FakeSocket.last.deliverBinary(packed);
    expect(net.match.time).toBeCloseTo(42.5, 1);
    expect(net.match.elixir[net.seat]).toBeCloseTo(3.25, 2);
    expect(net.match.hand[net.seat][0]?.id).toBe("snorlax");
    expect(net.match.projectiles).toHaveLength(1);
  });

  it("carries statuses across as the pips the renderer draws", () => {
    const { net } = connected();
    net.onEvents = (events) => { for (const e of events) net.rehydrate(e); };
    FakeSocket.last.deliver({ t: "ev", tick: 1, e: [spawn()] });
    const bits = statusBits(["paralysis", "confusion"]);
    FakeSocket.last.deliver(snapFor([[17, 1, 1, 100, 0, 0, 0, 0, bits]]));

    const kinds = net.match.units[0].statuses.map((s) => s.kind);
    expect(kinds).toContain("paralysis");
    expect(kinds).toContain("confusion");
  });
});

describe("turning events back into things the renderer knows", () => {
  it("builds a unit from a spawn", () => {
    const { net } = connected();
    const e = net.rehydrate(spawn())!;
    expect(e.type).toBe("spawn");
    const unit = (e as { unit: { card: { id: string }; id: number } }).unit;
    expect(unit.card.id).toBe("charmander");
    expect(unit.id).toBe(17);
  });

  it("drops an event whose subject is not on this board", () => {
    // A hit on a unit already removed, most often. Inventing a placeholder to
    // draw damage on would put a number over empty grass.
    const { net } = connected();
    expect(net.rehydrate({ e: "hit", id: 404, amount: 10, mult: 1, from: 405 }))
      .toBeUndefined();
    expect(net.rehydrate({ e: "ready", id: 404 })).toBeUndefined();
  });

  it("resolves a hit between two things it knows", () => {
    const { net } = connected();
    net.rehydrate(spawn());
    net.rehydrate(spawn({ id: 18, side: config.PLAYER }));
    const hit = net.rehydrate({ e: "hit", id: 17, amount: 42, mult: 2, from: 18 });
    expect(hit).toMatchObject({ type: "hit", amount: 42, mult: 2 });
  });

  it("finds towers by id, not only units", () => {
    const { net } = connected();
    const tower = net.match.towers[0];
    const down = net.rehydrate({ e: "towerDown", id: tower.id });
    expect(down).toMatchObject({ type: "towerDown" });
  });

  it("marks a thing dead when it dies", () => {
    const { net } = connected();
    net.rehydrate(spawn());
    net.rehydrate({ e: "death", id: 17, tower: false });
    expect(net.match.units.find((u) => u.id === 17)!.dead).toBe(true);
  });

  it("names the cards in an evolution and a choice", () => {
    const { net } = connected();
    expect(net.rehydrate({
      e: "evolve", side: config.ENEMY, from: "charmander", to: "charmeleon",
    })).toMatchObject({ type: "evolve" });
    expect(net.rehydrate({
      e: "choice", side: config.ENEMY, id: "c1", from: "eevee",
      options: ["vaporeon", "jolteon"],
    })).toMatchObject({ type: "choice", id: "c1" });
  });

  it("passes the result through untouched", () => {
    const { net } = connected();
    expect(net.rehydrate({ e: "over", result: "player" }))
      .toEqual({ type: "over", result: "player" });
  });

  it("refuses to invent a card it does not know", () => {
    const { net } = connected();
    expect(net.rehydrate(spawn({ card: "not-a-pokemon" }))).toBeUndefined();
  });
});

describe("intents", () => {
  it("sends a deploy and numbers it", () => {
    const { net, socket } = connected();
    const seq = net.deploy(2, 100, 300, "deoxysattack");
    const sent = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
    expect(sent).toMatchObject({ t: "deploy", seq, slot: 2, x: 100, y: 300, form: "deoxysattack" });
  });

  it("numbers every intent differently, so a refusal names one", () => {
    const { net } = connected();
    expect(net.deploy(0, 1, 1)).not.toBe(net.choose("c1", "vaporeon"));
  });

  it("says nothing on a closed socket rather than throwing", () => {
    const { net, socket } = connected();
    socket.close();
    expect(() => net.deploy(0, 1, 1)).not.toThrow();
  });

  it("measures round trip from a pong", () => {
    const { net, socket } = connected();
    net.ping();
    const sent = JSON.parse(socket.sent.at(-1)!) as { c: number };
    socket.deliver({ t: "pong", c: sent.c, tick: 5 });
    expect(net.latency).toBeGreaterThanOrEqual(0);
  });
});

describe("events that arrive before anything is listening", () => {
  it("are held, not dropped", () => {
    // Rejoining sends every unit on the board immediately after the handshake,
    // while the scene is still loading art. Dropping those left a player in an
    // empty arena where nothing spawned, moved or attacked.
    const net = new NetMatch("ws://test", {
      onSeat: () => {}, onStart: () => {}, onEvents: () => {},
      onOver: () => {}, onReject: () => {}, onPeer: () => {}, onError: () => {},
    });
    net.connect("tkt", HELLO.me.deck, "togekiss");
    FakeSocket.last.onopen?.();
    FakeSocket.last.deliver(HELLO);
    FakeSocket.last.deliver({ t: "ev", tick: 1, e: [spawn(), spawn({ id: 18 })] });

    const received: WireEvent[] = [];
    net.onEvents = (events) => received.push(...events);
    expect(received.map((e) => (e as { id: number }).id)).toEqual([17, 18]);
  });

  it("go straight through once a listener exists", () => {
    const { net } = connected();
    const received: WireEvent[] = [];
    net.onEvents = (events) => received.push(...events);
    FakeSocket.last.deliver({ t: "ev", tick: 2, e: [spawn({ id: 21 })] });
    expect(received).toHaveLength(1);
  });
});

describe("what the server refuses, and what it says", () => {
  it("reports a rejection against the intent that caused it", () => {
    const rejects: Array<{ seq: number; code: string }> = [];
    const net = new NetMatch("ws://test", {
      onSeat: () => {}, onStart: () => {}, onEvents: () => {}, onOver: () => {},
      onReject: (seq, code) => rejects.push({ seq, code }),
      onPeer: () => {}, onError: () => {},
    });
    net.connect("tkt", HELLO.me.deck, "togekiss");
    FakeSocket.last.deliver({ t: "reject", seq: 7, code: "elixir" });
    expect(rejects).toEqual([{ seq: 7, code: "elixir" }]);
  });

  it("does not talk over the reason when the server hangs up", () => {
    // The refusal arrives, then the socket closes. Reporting the close as
    // "opponent disconnected" overwrote the explanation *and* named the wrong
    // subject -- it is our own socket.
    const notes: string[] = [];
    const net = new NetMatch("ws://test", {
      onSeat: () => {}, onStart: () => {}, onEvents: () => {}, onOver: () => {},
      onReject: () => {}, onPeer: () => {},
      onError: (m) => notes.push(m), onNote: (t) => notes.push(t),
    });
    net.connect("tkt", HELLO.me.deck, "togekiss");
    FakeSocket.last.deliver({ t: "error", message: "already playing in another tab" });
    FakeSocket.last.onclose?.();
    expect(notes).toEqual(["already playing in another tab"]);
  });
});

describe("the status bitmask both ends share", () => {
  it("round-trips every kind", () => {
    const kinds = ["paralysis", "flinch", "confusion", "armorBreak", "burn", "poison", "sleep"];
    expect(bitsToStatus(statusBits(kinds))).toEqual(kinds);
  });

  it("ignores a kind it does not have a bit for", () => {
    // A newer server sending an unknown status must not shift every other bit.
    expect(statusBits(["paralysis", "invented"])).toBe(statusBits(["paralysis"]));
  });

  it("is empty for nothing", () => {
    expect(statusBits([])).toBe(0);
    expect(bitsToStatus(0)).toEqual([]);
  });

  it("agrees with the action codes the renderer uses", () => {
    expect(ACTIONS[0]).toBe("Walk");
    expect(byId("charmander")).toBeTruthy();
  });
})

describe("a lane opened by a broken tower", () => {
  /*
   * Reported by somebody playing: the lane opened, then stopped working after
   * a reconnect.
   *
   * A rejoin builds a fresh mirror, and `resync` does not describe the towers
   * -- it sends the greeting and the creatures. Everything a client knows
   * about tower health comes from the snapshot, so this is the path that has
   * to carry the fact that a tower has fallen. If it does not, the deploy
   * zone silently closes again and the reward for the tower is revoked.
   */
  const deadTowerSnap = (net: ReturnType<typeof connected>["net"]) => {
    const mine = net.seat;
    const theirs = net.match.towers.find(
      (t) => t.side !== mine && t.kind === "side" && t.x < config.arenaWidth / 2)!;
    return {
      snap: encodeSnap({
        tick: 30, left: 120, u: [], p: [],
        w: net.match.towers.map((t) => [t.id, t.id === theirs.id ? 0 : t.maxHP, 1, 0, 0] as
          [number, number, number, number, number]),
        // A real hand: `canDeploy` asks what is in the slot, and an empty one
        // is refused for the ordinary reason rather than the zone.
        me: { e: 10, hand: ["charmander", "machop", "geodude", "voltorb"], next: "eevee" },
      }),
      theirs,
    };
  };

  it("is open again after a reconnect, from the snapshot alone", () => {
    const fresh = connected();          // as if the page had just been reloaded
    const { snap, theirs } = deadTowerSnap(fresh.net);

    expect(theirs.dead).toBe(false);
    fresh.socket.deliverBinary(snap);

    expect(theirs.dead).toBe(true);
    expect(laneOpen(fresh.net.match, fresh.net.seat, theirs.x, theirs.y - forwardFor(fresh.net.seat) * 60))
      .toBe(true);
  });

  it("puts a too-deep drop at the line, not back in my own half", () => {
    const fresh = connected();
    const { snap, theirs } = deadTowerSnap(fresh.net);
    fresh.socket.deliverBinary(snap);

    const mine = fresh.net.seat;
    const half = config.arenaHeight / 2;
    // Well past what was won: it should come back to the line, not all the
    // way home.
    const at = nearestDeploy(fresh.net.match, mine, theirs.x, theirs.y, theirs.x, false, false);
    const ownHalf = forwardFor(mine) < 0 ? half + config.deployMargin : half - config.deployMargin;

    expect(at.y).not.toBe(ownHalf);
    expect(canDeploy(fresh.net.match, mine, 0, at.x, at.y)).toBe(true);
  });
});
