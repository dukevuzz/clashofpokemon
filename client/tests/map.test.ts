/**
 * The board: its geometry, and the rule that the drawn thing and the simulated
 * thing must agree.
 *
 * Every check here exists because that agreement broke once. Creatures stood on
 * tower staircases the physics thought were empty; riders sat on the bottom rim
 * of a plate rather than in it; an Espeon walked across open water because the
 * river was a painting the core could not see; cards were deployed into that
 * water because the deploy line sat inside it.
 *
 * The pattern in all four is the same -- a number the renderer knew and the
 * simulation did not, or the reverse -- so these tests are mostly about
 * comparing the two halves.
 */

import { describe, expect, test } from "vitest";
import { config, towerRangeOf } from "../src/core/config";
import { Match } from "../src/core/match";
import terrain from "../src/data/terrain.json" with { type: "json" };

const TOWER_ART = terrain.towers;
const riverTop = config.riverY - config.riverHeight / 2;
const riverBot = config.riverY + config.riverHeight / 2;
const onBridge = (x: number) =>
  config.bridgeX.some((bx) => Math.abs(x - bx) <= config.bridgeHalfWidth);

describe("the arena", () => {
  test("is a whole number of tiles", () => {
    expect(config.arenaWidth % config.unitSize).toBe(0);
    expect(config.arenaHeight % config.unitSize).toBe(0);
  });

  test("the river sits on the midline", () => {
    expect(config.riverY).toBe(config.arenaHeight / 2);
  });

  test("both lanes are mirrored about the centre", () => {
    const [l, r] = config.laneX;
    expect(config.arenaWidth - r).toBe(l);
  });
});

describe("the river and its crossings", () => {
  test("each bridge is inside the board", () => {
    for (const bx of config.bridgeX) {
      expect(bx - config.bridgeHalfWidth).toBeGreaterThan(0);
      expect(bx + config.bridgeHalfWidth).toBeLessThan(config.arenaWidth);
    }
  });

  test("each lane leads onto its own bridge", () => {
    // A unit walks the lane. If the lane centre is not on the planks it arrives
    // beside the crossing and is turned back by water it is standing next to.
    config.laneX.forEach((lx, i) => {
      expect(onBridge(lx), `lane ${i} at ${lx} vs bridge ${config.bridgeX[i]}`).toBe(true);
    });
  });

  test("a bridge is a chokepoint, not a doorway", () => {
    // Wide enough for one creature and a bit, which is what makes a crossing a
    // place a fight happens. Verified as a range rather than a value so a
    // deliberate retune does not fail the suite, but a tenfold one does.
    const span = config.bridgeHalfWidth * 2;
    expect(span).toBeGreaterThanOrEqual(config.unitSize);
    expect(span).toBeLessThanOrEqual(config.unitSize * 3);
  });

  test("the deploy line clears the water", () => {
    // At margin 20 against a half-river of 36, the bottom 16 units of your own
    // legal half were open water, and a measured run found 1,447 frames of
    // ground units standing in the river having been placed there.
    expect(config.deployMargin).toBeGreaterThanOrEqual(config.riverHeight / 2);
  });
});

describe("towers", () => {
  test.each(["side", "king"] as const)(
    "%s tower art reaches exactly its collision box", (kind) => {
      // `mount` is the row drawn at the tower's logical position, so it splits
      // the art's height into the two halves of towerBox at the scale the art
      // is drawn at. Retune one without the other and the building is drawn
      // somewhere it cannot be walked into.
      const art = TOWER_ART[kind];
      const z = config.towerSize[kind] / art.w;
      const box = config.towerBox[kind];
      const [, my] = art.mount;
      expect(Math.abs(my * z - box.up)).toBeLessThan(1.5);
      expect(Math.abs((art.h - my) * z - box.down)).toBeLessThan(1.5);
    },
  );

  test.each(["side", "king"] as const)(
    "%s tower seat is a separate point from its mount", (kind) => {
      // Making them equal again is the regression that sat every rider on the
      // bottom rim of its plate instead of in the middle of it.
      const art = TOWER_ART[kind];
      expect(art.seat[1]).not.toBe(art.mount[1]);
      expect(art.seat[0]).toBeGreaterThanOrEqual(0);
      expect(art.seat[0]).toBeLessThanOrEqual(art.w);
      expect(art.seat[1]).toBeGreaterThanOrEqual(0);
      expect(art.seat[1]).toBeLessThanOrEqual(art.h);
    },
  );

  test("a lane tower does not cover the mouth of the bridge", () => {
    // Crossing has to be a decision. If the tower already reaches the near
    // mouth there is nothing to decide -- you are shot for stepping on.
    const gap = riverBot - config.towerBackOff.side;
    expect(gap).toBeGreaterThan(towerRangeOf("side"));
  });

  test("a king does not reach the river at all", () => {
    const gap = riverTop - config.towerBackOff.king;
    expect(gap).toBeGreaterThan(towerRangeOf("king"));
  });

  test("both sides get the same towers in mirrored places", () => {
    const m = new Match({});
    const mine = m.towers.filter((t) => t.side === config.PLAYER);
    const theirs = m.towers.filter((t) => t.side === config.ENEMY);
    expect(mine.length).toBe(theirs.length);
    for (const t of mine) {
      const mirror = theirs.find(
        (o) => o.kind === t.kind && Math.abs((config.arenaHeight - o.y) - t.y) < 0.001,
      );
      expect(mirror, `no mirror for ${t.kind} at ${t.x},${t.y}`).toBeTruthy();
    }
  });
});

describe("deployment", () => {
  const m = new Match({});

  test("a normal card never lands in the enemy half", () => {
    const half = config.arenaHeight / 2;
    for (let x = 10; x < config.arenaWidth; x += 11) {
      for (let y = 10; y < config.arenaHeight; y += 11) {
        const at = m.nearestDeploy(config.PLAYER, x, y, x, false, false);
        expect(at.y).toBeGreaterThanOrEqual(half + config.deployMargin - 0.001);
      }
    }
  });

  test("a delivery never lands illegally either", () => {
    // A drop is delivered but still own-half only, so the vertical exit added
    // for deliveries must not carry it over the line.
    const half = config.arenaHeight / 2;
    for (let x = 10; x < config.arenaWidth; x += 11) {
      for (let y = half + config.deployMargin; y < config.arenaHeight - 10; y += 11) {
        const at = m.nearestDeploy(config.PLAYER, x, y, x, false, true);
        expect(at.y).toBeGreaterThanOrEqual(half + config.deployMargin - 0.001);
      }
    }
  });

  test("nothing is ever placed inside a tower", () => {
    for (let x = 10; x < config.arenaWidth; x += 7) {
      for (let y = 10; y < config.arenaHeight; y += 7) {
        const at = m.nearestDeploy(config.PLAYER, x, y, x, true, true);
        for (const t of m.towers) {
          const box = config.towerBox[t.kind];
          const clear = config.towerSize[t.kind] * 0.5;
          const inside =
            Math.abs(at.x - t.x) < clear && at.y > t.y - box.up && at.y < t.y + box.down;
          expect(inside, `(${at.x},${at.y}) is inside a ${t.kind} tower`).toBe(false);
        }
      }
    }
  });

  test("a thrown card lands close to where it was aimed", () => {
    // Not exactly: a tower is solid and nothing may land in one. But the mean
    // shift should be a fraction of a body, not most of one.
    let total = 0, n = 0;
    for (let x = 10; x < config.arenaWidth; x += 5) {
      for (let y = 10; y < config.arenaHeight; y += 5) {
        const at = m.nearestDeploy(config.PLAYER, x, y, x, true, true);
        total += Math.hypot(at.x - x, at.y - y);
        n++;
      }
    }
    expect(total / n).toBeLessThan(config.unitSize / 2);
  });
});
