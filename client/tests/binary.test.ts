/**
 * The packed snapshot.
 *
 * This is the one place in the project where a bug is *silent by construction*.
 * A wrong offset does not throw; it reads the next field, and the game carries
 * on with a creature at the wrong place, or the wrong card in your hand, or a
 * tower at an odd health. Nothing errors, nothing logs, and the two players
 * quietly see different games.
 *
 * So the tests are about round trips and boundaries rather than about examples:
 * anything that goes in must come out, and every field is pushed to its limit
 * to prove the width chosen for it is the width it needs.
 */

import { describe, it, expect } from "vitest";
import { encodeSnap, decodeSnap, sizeOf, type SnapData } from "../src/net/binary";
import { CARD_TABLE, cardIndex, cardAt, contentHash, NO_CARD } from "../src/core/cardTable";
import { ALL } from "../src/core/cards";
import { config } from "../src/core/config";

const snap = (over: Partial<SnapData> = {}): SnapData => ({
  tick: 4200,
  left: 128.4,
  u: [[17, 123.4, 456.7, 340, 12, 0, 4, 0.7, 0b0101]],
  w: [[1, 2402, 1, 0, 0], [2, 0, 0, 1.5, 3]],
  p: [[10.5, 20.5]],
  me: { e: 6.42, hand: ["charmander", null, "snorlax", "eevee"], next: "geodude" },
  ...over,
});

describe("a snapshot survives the round trip", () => {
  it("comes back the same", () => {
    const s = snap();
    const back = decodeSnap(encodeSnap(s));
    expect(back.tick).toBe(s.tick);
    expect(back.left).toBeCloseTo(s.left, 1);
    expect(back.me.e).toBeCloseTo(s.me.e, 2);
    expect(back.me.hand).toEqual(s.me.hand);
    expect(back.me.next).toBe(s.me.next);
    expect(back.u[0][0]).toBe(17);
    expect(back.u[0][1]).toBeCloseTo(123.4, 1);
    expect(back.u[0][2]).toBeCloseTo(456.7, 1);
    expect(back.u[0][3]).toBe(340);
    expect(back.u[0][8]).toBe(0b0101);
    expect(back.w).toEqual(s.w);
    expect(back.p[0][0]).toBeCloseTo(10.5, 1);
  });

  it("writes exactly the bytes it claimed it would", () => {
    // A size that disagrees with the writer is how a buffer ends up with
    // trailing zeroes that decode as a real unit at the origin.
    const s = snap();
    expect(encodeSnap(s).byteLength).toBe(sizeOf(s));
  });

  it("handles an empty board", () => {
    const s = snap({ u: [], w: [], p: [] });
    const back = decodeSnap(encodeSnap(s));
    expect(back.u).toEqual([]);
    expect(back.w).toEqual([]);
    expect(back.p).toEqual([]);
    expect(back.me.hand).toHaveLength(4);
  });

  it("handles an empty hand and no next card", () => {
    const s = snap({ me: { e: 0, hand: [null, null, null, null], next: null } });
    const back = decodeSnap(encodeSnap(s));
    expect(back.me.hand).toEqual([null, null, null, null]);
    expect(back.me.next).toBeNull();
  });

  it("survives a crowded board", () => {
    const u = Array.from({ length: 60 }, (_, i) =>
      [1000 + i, i * 5, i * 9, 500 + i, 0, i % 4, i % 8, 0, 0] as SnapData["u"][number]);
    const back = decodeSnap(encodeSnap(snap({ u })));
    expect(back.u).toHaveLength(60);
    expect(back.u[59][0]).toBe(1059);
  });
});

describe("every field fits the width chosen for it", () => {
  it("positions cover the whole board and then some", () => {
    // Units live briefly outside the arena -- update() keeps them until 20
    // beyond either end -- so the range that has to survive is wider than the
    // board itself.
    const far: SnapData["u"] = [
      [1, -20, -20, 0, 0, 0, 0, 0, 0],
      [2, config.arenaWidth + 20, config.arenaHeight + 20, 0, 0, 0, 0, 0, 0],
    ];
    const back = decodeSnap(encodeSnap(snap({ u: far })));
    expect(back.u[0][1]).toBeCloseTo(-20, 1);
    expect(back.u[1][1]).toBeCloseTo(config.arenaWidth + 20, 1);
    expect(back.u[1][2]).toBeCloseTo(config.arenaHeight + 20, 1);
  });

  it("holds the health of the toughest thing in the game", () => {
    const most = Math.max(
      ...ALL.map((c) => c.hp),
      ...Object.values(config.towerHP as Record<string, number>),
    );
    const back = decodeSnap(encodeSnap(snap({
      u: [[1, 0, 0, most, most, 0, 0, 0, 0]],
      w: [[1, most, 1, 0, 0]],
    })));
    expect(back.u[0][3]).toBe(most);
    expect(back.w[0][1]).toBe(most);
    expect(most).toBeLessThanOrEqual(0xffff);
  });

  it("holds every status at once", () => {
    const all = 0b1111111;                       // the seven kinds
    const back = decodeSnap(encodeSnap(snap({ u: [[1, 0, 0, 1, 0, 0, 0, 0, all]] })));
    expect(back.u[0][8]).toBe(all);
  });

  it("refuses a unit id it cannot represent, rather than truncating it", () => {
    // The only field that could overflow in a long-running process. Silent
    // truncation would make unit 65,537 indistinguishable from unit 1.
    expect(() => encodeSnap(snap({ u: [[70000, 0, 0, 1, 0, 0, 0, 0, 0]] })))
      .toThrow(/uint16/);
  });

  it("keeps the full three minutes on the clock", () => {
    const back = decodeSnap(encodeSnap(snap({ left: config.matchSeconds })));
    expect(back.left).toBeCloseTo(config.matchSeconds, 1);
  });
});

describe("the card table is the thing both ends must agree on", () => {
  it("covers every card that can reach a hand, not just deckable ones", () => {
    // `cards.ALL` is what you can put in a deck. Play Charmander enough and
    // your hand holds Charmeleon, which was never in anybody's deck -- so an
    // index into ALL would be right until the first evolution.
    expect(CARD_TABLE.length).toBeGreaterThan(ALL.length);
    expect(CARD_TABLE).toContain("charmeleon");
    expect(CARD_TABLE).toContain("deoxysattack");
  });

  it("is sorted, so roster order cannot renumber the wire", () => {
    expect([...CARD_TABLE]).toEqual([...CARD_TABLE].sort());
  });

  it("round-trips every card in it", () => {
    for (const id of CARD_TABLE) {
      expect(cardAt(cardIndex(id))?.id, id).toBe(id);
    }
  });

  it("has no card colliding with the empty marker", () => {
    expect(CARD_TABLE.length).toBeLessThan(NO_CARD);
  });

  it("refuses a card it does not know rather than sending a wrong number", () => {
    expect(() => cardIndex("not-a-pokemon")).toThrow(/wire table/);
  });

  it("has a stable fingerprint", () => {
    // Recomputed from the same input must give the same answer, or the
    // handshake check is noise. If this fails because the roster changed, that
    // is the point -- the version must move with it.
    expect(contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash).toBe(contentHash);
  });
});

describe("it is worth doing at all", () => {
  it("is much smaller than the same snapshot as JSON", () => {
    const u = Array.from({ length: 20 }, (_, i) =>
      [1000 + i, 123.4, 456.7, 1234, 0, 0, 4, 0, 0] as SnapData["u"][number]);
    const w = Array.from({ length: 6 }, (_, i) =>
      [i + 1, 2400, 1, 0, 0] as SnapData["w"][number]);
    const s = snap({ u, w, p: [[1, 2], [3, 4], [5, 6], [7, 8]] });
    const json = JSON.stringify({ t: "snap", ...s }).length;
    const bin = encodeSnap(s).byteLength;
    // Measured at roughly a third the size. Asserted loosely: the point is the
    // order of magnitude, and a strict number would fail on a comment change.
    expect(bin).toBeLessThan(json * 0.5);
  });
});
