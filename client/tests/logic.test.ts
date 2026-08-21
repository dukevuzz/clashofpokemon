/**
 * The rules, run.
 *
 * These play real matches with a seeded generator rather than asserting on
 * hand-built state, because almost every bug this project has shipped was an
 * interaction rather than a wrong constant: a unit that walked through water
 * only when it had a target, a status that leaked onto the ordinary attack
 * path, a leap that never started because its trigger was also its guard.
 *
 * Kept to a handful of matches each. The long sweeps -- 700-match pacing,
 * 3.9-million-sample river scans -- stay in tools/selfcheck.ts, which is run
 * deliberately rather than on every save.
 */

import { describe, expect, it, test } from "vitest";
import { Match, gapTo, boxOf, type Unit } from "../src/core/match";
import { AI } from "../src/core/ai";
import { config } from "../src/core/config";
import * as cards from "../src/core/cards";
import { byId } from "../src/core/cards";
import { spawn, arrivalTime } from "../src/core/deploy";
import * as hand from "../src/core/hand";
import { findTarget, castSkill, applyHit } from "../src/core/combat";
import * as status from "../src/core/status";
import * as evolution from "../src/core/evolution";

/** A small deterministic generator, so a failure can be reproduced exactly. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 1 / 30;

/** Play one match to its end, handing every event to `watch`. */
function play(seed: number, watch?: (m: Match, events: unknown[]) => void) {
  const rng = seeded(seed);
  const m = new Match({
    playerDeck: cards.newDeck(rng), enemyDeck: cards.newDeck(rng), rng,
  });
  const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
  let steps = 0;
  while (!m.over && steps++ < 20000) {
    const events = m.update(STEP);
    p.update(m, STEP); e.update(m, STEP);
    watch?.(m, events);
  }
  return m;
}

const SEEDS = [1, 2, 3, 4, 5];

describe("a match stays inside its own rules", () => {
  test.each(SEEDS)("seed %i produces no impossible state", (seed) => {
    play(seed, (m) => {
      for (const side of [config.PLAYER, config.ENEMY] as const) {
        expect(m.elixir[side]).toBeGreaterThanOrEqual(-0.001);
        expect(m.elixir[side]).toBeLessThanOrEqual(config.elixirMax + 0.001);
      }
      for (const u of m.units) {
        expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
        expect(u.hp).toBeGreaterThanOrEqual(0);
        expect(u.x).toBeGreaterThanOrEqual(0);
        expect(u.x).toBeLessThanOrEqual(config.arenaWidth);
      }
    });
  });

  test.each(SEEDS)("seed %i finishes", (seed) => {
    expect(play(seed).over).toBeTruthy();
  });

  test("the same seed always plays the same match", () => {
    // Not a nicety: this is what a replay and a server both need, and it is the
    // property the fixed timestep exists to protect.
    const a = play(77), b = play(77);
    expect(a.over).toBe(b.over);
    expect(a.towers.map((t) => t.hp)).toEqual(b.towers.map((t) => t.hp));
  });
});

describe("the river", () => {
  const top = config.riverY - config.riverHeight / 2;
  const bot = config.riverY + config.riverHeight / 2;
  const onBridge = (x: number) =>
    config.bridgeX.some((bx) => Math.abs(x - bx) <= config.bridgeHalfWidth);

  test.each(SEEDS)("seed %i: nothing that cannot swim ends a frame in water", (seed) => {
    let swam = 0, crossed = 0;
    play(seed, (m) => {
      for (const u of m.units) {
        if (u.dead) continue;
        // Who is allowed over the water at all depends on the switch. With
        // `riverBypass` off nobody is, fliers included, so the exemptions have
        // to be conditional -- otherwise this passes by simply not looking at
        // the creatures whose behaviour changed.
        if (config.riverBypass && (u.flying || u.leap)) continue;
        if (u.y <= top || u.y >= bot) continue;

        // The planks first. A jumper standing on a bridge is crossing the way
        // everything else does; only one off the bridge and not mid-leap is
        // in the water. Testing `jumpsRiver` before the bridge counted every
        // legitimate bridge crossing as a swim the moment leaping stopped.
        if (onBridge(u.x)) { crossed++; continue; }
        swam++;
      }
    });
    expect(swam).toBe(0);
    expect(crossed).toBeGreaterThan(0);   // a wall with no doors is not a river
  });

  test.each(SEEDS)("seed %i: a leap always ends", (seed) => {
    play(seed, (m) => {
      for (const u of m.units) {
        if (u.leap) expect(u.leap.t).toBeLessThanOrEqual(config.leapTime + 0.1);
      }
    });
  });
});

describe("towers", () => {
  test.each(SEEDS)("seed %i: nothing stands inside stonework", (seed) => {
    play(seed, (m) => {
      for (const u of m.units) {
        if (u.dead || u.flying) continue;
        for (const t of m.towers) {
          if (t.dead) continue;
          const box = config.towerBox[t.kind];
          const clear = config.towerSize[t.kind] * 0.5;
          const inside =
            Math.abs(u.x - t.x) < clear - 1 && u.y > t.y - box.up + 1 && u.y < t.y + box.down - 1;
          expect(inside, `${u.card.name} inside a ${t.kind} tower`).toBe(false);
        }
      }
    });
  });

  test("a king sleeps until it is woken", () => {
    const m = new Match({ rng: seeded(9) });
    for (const t of m.towers) if (t.kind === "king") expect(t.active).toBe(false);
  });
});

describe("status effects", () => {
  test("only a cast ever causes one", () => {
    // The load-bearing rule of the whole system. If a status ever starts
    // landing off ordinary attacks the game has quietly become another game.
    let hits = 0, applied = 0;
    for (const seed of SEEDS) {
      play(seed, (_m, events) => {
        for (const e of events as { type: string }[]) {
          if (e.type === "hit") hits++;
          if (e.type === "status") applied++;
        }
      });
    }
    expect(applied).toBeGreaterThan(0);
    expect(applied / hits).toBeLessThan(0.05);
  });

  test.each(SEEDS)("seed %i: statuses refresh rather than stack", (seed) => {
    play(seed, (m) => {
      for (const u of m.units) {
        const kinds = u.statuses.map((s) => s.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
        for (const s of u.statuses) expect(s.left).toBeGreaterThan(0);
      }
    });
  });

  test("towers are never afflicted", () => {
    for (const seed of SEEDS) {
      play(seed, (m) => {
        for (const t of m.towers) {
          expect((t as unknown as { statuses?: unknown }).statuses).toBeUndefined();
        }
      });
    }
  });

  test("a slept unit wakes when it is hit", () => {
    const list: status.Status[] = [];
    status.apply(list, "sleep", 5);
    expect(status.has(list, "sleep")).toBe(true);
    status.wake(list);
    expect(status.has(list, "sleep")).toBe(false);
  });

  test("applying twice extends rather than duplicates", () => {
    const list: status.Status[] = [];
    status.apply(list, "burn", 2);
    status.apply(list, "burn", 5);
    expect(list.length).toBe(1);
    expect(list[0].left).toBe(5);
    // And a shorter one does not cut a longer one short.
    status.apply(list, "burn", 1);
    expect(list[0].left).toBe(5);
  });

  test("a status expires", () => {
    const list: status.Status[] = [];
    status.apply(list, "freeze", 1);
    status.tick(list, 0.5);
    expect(list.length).toBe(1);
    status.tick(list, 0.6);
    expect(list.length).toBe(0);
  });
});

describe("deployment rules", () => {
  test("a card cannot be played without the elixir for it", () => {
    const m = new Match({ rng: seeded(3) });
    m.elixir[config.PLAYER] = 0;
    const played = m.deploy(config.PLAYER, 0, config.laneX[0], config.arenaHeight - 60);
    expect(played).toBe(false);
  });

  test("playing a card spends exactly its cost", () => {
    const m = new Match({ rng: seeded(4) });
    m.elixir[config.PLAYER] = config.elixirMax;
    const card = m.hand[config.PLAYER][0]!;
    const before = m.elixir[config.PLAYER];
    m.deploy(config.PLAYER, 0, config.laneX[0], config.arenaHeight - 60);
    expect(before - m.elixir[config.PLAYER]).toBeCloseTo(m.costOf(config.PLAYER, card), 5);
  });

  test("a multi-body card puts down exactly that many bodies", () => {
    const swarm = cards.ALL.find((c) => c.count > 1)!;
    const m = new Match({
      playerDeck: [swarm, ...cards.ALL.filter((c) => c !== swarm).slice(0, 5)],
      rng: seeded(5),
    });
    m.elixir[config.PLAYER] = config.elixirMax;
    const slot = m.hand[config.PLAYER].findIndex((c) => c?.id === swarm.id);
    if (slot < 0) return;   // not dealt into the opening hand
    m.deploy(config.PLAYER, slot, config.laneX[0], config.arenaHeight - 60);
    const mine = m.units.filter((u: Unit) => u.card.id === swarm.id);
    expect(mine.length).toBe(swarm.count);
  });
});

describe("a rooted card holds its ground", () => {
  test("it never moves from where it was placed", () => {
    // No card is rooted at the moment: Sudowoodo had a fighter's 15-unit reach
    // and could not hit anything that was not already touching it, so it stood
    // still and died having done nothing. The mechanic stays tested for
    // whenever a card is given a building's reach to go with it.
    const tree = cards.ALL.find((c) => c.speed === 0);
    if (!tree) return;
    const m = new Match({
      playerDeck: [tree!, ...cards.ALL.filter((c) => c !== tree).slice(0, 5)],
      rng: seeded(6),
    });
    const home = new Map<number, { x: number; y: number }>();
    const p = new AI(config.PLAYER, seeded(6)), e = new AI(config.ENEMY, seeded(7));
    let steps = 0;
    while (!m.over && steps++ < 6000) {
      m.update(STEP); p.update(m, STEP); e.update(m, STEP);
      for (const u of m.units) {
        if (u.card.id !== tree!.id || u.dead) continue;
        const at = home.get(u.id);
        if (!at) home.set(u.id, { x: u.x, y: u.y });
        else expect(Math.hypot(u.x - at.x, u.y - at.y)).toBeLessThan(1);
      }
    }
  });
});

describe("ground units walk to the bridge, not into the bank", () => {
  const riverTop = config.riverY - config.riverHeight / 2;
  const riverBot = config.riverY + config.riverHeight / 2;

  it.each([150, 190, 240, 40])("from x=%i it lines up before it reaches the water", (startX) => {
    const m = new Match(9);
    const u = spawn(m, byId("charmander")!, config.PLAYER, startX, 470);
    u.spawning = 0;

    let scraped = 0;
    let crossed = false;
    for (let i = 0; i < 30 * 40 && !u.dead; i++) {
      m.update(1 / 30);
      // Sitting exactly on the bank line is the symptom: stopped by the river
      // and sliding sideways, rather than walking to the planks.
      if (Math.abs(u.y - riverBot) < 1.5) scraped++;
      if (u.y < riverTop) { crossed = true; break; }
    }

    expect(crossed).toBe(true);
    // A few frames crossing the line is normal; dozens means it is scraping.
    expect(scraped).toBeLessThan(20);
  });

  it("arrives at the bridge before it arrives at the water", () => {
    const m = new Match(9);
    const u = spawn(m, byId("charmander")!, config.PLAYER, 190, 470);
    u.spawning = 0;
    const bx = config.bridgeX[u.lane];

    let xAtBank: number | undefined;
    for (let i = 0; i < 30 * 40 && !u.dead; i++) {
      m.update(1 / 30);
      if (xAtBank === undefined && u.y <= riverBot) xAtBank = u.x;
      if (u.y < riverTop) break;
    }
    expect(xAtBank).toBeDefined();
    // Within the planks when it meets the water, rather than out in the field.
    expect(Math.abs(xAtBank! - bx)).toBeLessThan(config.bridgeHalfWidth);
  });
});

describe("a card lands where the marker promised", () => {
  const nearTower = (m: Match) =>
    m.towers.find((t) => t.side === config.PLAYER && t.kind === "side" && t.x > 192)!;

  it("a tap near your own tower is not thrown across the lane", () => {
    // The push out of a tower used to be lateral-only for anything that was not
    // thrown or dropped, so tapping just above your own tower moved the card 46
    // units sideways -- most of two bodies -- when a few units up was legal and
    // nearer. Reported as "the drop off spot not correct".
    const m = new Match(3);
    const t = nearTower(m);
    for (const [dx, dy] of [[0, 30], [0, -30], [10, -25]]) {
      const aim = { x: t.x + dx, y: t.y + dy };
      const at = m.nearestDeploy(config.PLAYER, aim.x, aim.y, aim.x, false, false);
      const moved = Math.hypot(at.x - aim.x, at.y - aim.y);
      expect(moved, `aim (${aim.x},${aim.y})`).toBeLessThan(45);
    }
  });

  it("the side you release on is the side it lands on", () => {
    // Clash Royale places where you let go. This used to lean on where the
    // *drag began*, so pulling a card from the hand at the bottom left and
    // releasing it on the right of a tower pushed it out to the left. Reported
    // as "if I set it on the right side of tower but then it spawn at left?".
    const m = new Match(3);
    const t = nearTower(m);
    const fingerFromLeft = 60, fingerFromRight = 360;

    const right = m.nearestDeploy(config.PLAYER, t.x + 20, t.y + 10, fingerFromLeft, false, false);
    expect(right.x).toBeGreaterThan(t.x);

    const left = m.nearestDeploy(config.PLAYER, t.x - 20, t.y + 10, fingerFromRight, false, false);
    expect(left.x).toBeLessThan(t.x);

    // Above and below count too: a release over the tower means up, not aside.
    const above = m.nearestDeploy(config.PLAYER, t.x, t.y - 30, fingerFromLeft, false, false);
    expect(above.y).toBeLessThan(t.y);
    expect(Math.abs(above.x - t.x)).toBeLessThan(2);
  });

  it("a dead-centre release falls back to the drag direction", () => {
    // The one case with no side of its own, and the only one where the finger's
    // travel is the sole information available.
    const m = new Match(3);
    const t = nearTower(m);
    expect(m.nearestDeploy(config.PLAYER, t.x, t.y, t.x + 60, false, false).x)
      .toBeGreaterThan(t.x);
    expect(m.nearestDeploy(config.PLAYER, t.x, t.y, t.x - 60, false, false).x)
      .toBeLessThan(t.x);
  });

  it("what lands is what the marker showed", () => {
    // The marker draws at nearestDeploy, so the two agree by construction --
    // but only while nothing moves the unit afterwards. `pushOutOfTowers` runs
    // on every unit every frame and would silently disagree.
    const m = new Match(3);
    const t = nearTower(m);
    const at = m.nearestDeploy(config.PLAYER, t.x, t.y + 30, t.x, false, false);
    m.hand[config.PLAYER][0] = byId("charmander")!;
    m.elixir[config.PLAYER] = 10;
    m.deploy(config.PLAYER, 0, at.x, at.y);
    const u = m.units[m.units.length - 1];
    for (let i = 0; i < 3; i++) m.update(1 / 30);
    expect(Math.hypot(u.x - at.x, u.y - at.y)).toBeLessThan(2);
  });
});

describe("a card still arriving is not on the board yet", () => {
  it("cannot be targeted while it is landing", () => {
    // A tunneller surfacing, a ball mid-arc, a Snorlax falling -- all were
    // attackable before they had landed. A card the player has not finished
    // placing cannot be answered, only sniped.
    const m = new Match(4);
    const falling = spawn(m, byId("snorlax")!, config.PLAYER, 190, 400);
    const enemy = spawn(m, byId("charmander")!, config.ENEMY, 190, 380);
    enemy.spawning = 0;

    expect(falling.spawning).toBeGreaterThan(0);
    const target = findTarget(m, enemy, enemy.aggro);
    expect(target === falling).toBe(false);
  });

  it("becomes a target the moment it lands", () => {
    const m = new Match(4);
    const arriving = spawn(m, byId("snorlax")!, config.PLAYER, 190, 400);
    const enemy = spawn(m, byId("charmander")!, config.ENEMY, 190, 380);
    enemy.spawning = 0;
    arriving.spawning = 0;
    expect(findTarget(m, enemy, enemy.aggro)).toBe(arriving);
  });

  it("takes no splash while arriving", () => {
    const m = new Match(4);
    const arriving = spawn(m, byId("snorlax")!, config.PLAYER, 190, 400);
    const victim = spawn(m, byId("charmander")!, config.PLAYER, 195, 400);
    victim.spawning = 0;
    const caster = spawn(m, byId("charmander")!, config.ENEMY, 190, 395);
    caster.spawning = 0;

    const before = arriving.hp;
    castSkill(m, caster, victim, 1);
    expect(arriving.hp).toBe(before);
  });
});

describe("only a big body makes you wait", () => {
  it("most cards sit at the floor", () => {
    // The floor stays -- it is the reaction window, and Clash Royale gives
    // every troop one. What changed is the shape: the ramp now sits at the top,
    // so a Roggenrola no longer feels almost as heavy as a Steelix.
    const quick = cards.ALL.filter((c) => c.deployDelay <= 0.6);
    expect(quick.length).toBeGreaterThan(cards.ALL.length * 0.7);
  });

  it("the biggest creatures still do", () => {
    const snorlax = cards.ALL.find((c) => c.id === "snorlax")!;
    expect(snorlax.deployDelay).toBeGreaterThan(1.5);
  });

  it("a small creature never waits longer than a large one", () => {
    const small = cards.ALL.find((c) => c.id === "roggenrola")!;
    const large = cards.ALL.find((c) => c.id === "snorlax")!;
    expect(small.deployDelay).toBeLessThan(large.deployDelay);
  });

  it("a delivery keeps its flight time whatever its size", () => {
    // Voltorb is tiny and still waits: a thrown card needs an arc, or it is an
    // instant hit anywhere on the board.
    const voltorb = cards.ALL.find((c) => c.id === "voltorb")!;
    expect(voltorb.deployDelay).toBeGreaterThan(1);
  });
});

describe("a throw is timed by how far it flies", () => {
  it("costs more the further it goes", () => {
    // The arrival was the card's flat deployDelay, so lobbing a Voltorb at your
    // own feet took exactly as long as lobbing it at their king. Distance is
    // the whole cost of a thrown card; a fixed time charges the same for both.
    const v = byId("voltorb")!;
    const near = arrivalTime(v, config.PLAYER, config.arenaHeight - 40);
    const mid = arrivalTime(v, config.PLAYER, 290);
    const far = arrivalTime(v, config.PLAYER, 52);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
  });

  it("keeps the longest throw at the price it always cost", () => {
    // The point is that a short defensive lob stops paying a long throw's
    // price -- not that reaching across the board gets cheaper.
    const far = arrivalTime(byId("voltorb")!, config.PLAYER, 52);
    expect(far).toBeGreaterThan(1.4);
    expect(far).toBeLessThan(1.6);
  });

  it("never arrives instantly, however short the lob", () => {
    const atFeet = arrivalTime(byId("voltorb")!, config.PLAYER, config.arenaHeight - 10);
    expect(atFeet).toBeGreaterThanOrEqual(config.throwMinTime);
  });

  it("leaves every other delivery on its flat time", () => {
    // Only a throw travels. A drop falls in place and a tunnel goes under.
    for (const id of ["snorlax", "diglett", "charmander"]) {
      const c = byId(id)!;
      expect(arrivalTime(c, config.PLAYER, 200)).toBe(c.deployDelay);
      expect(arrivalTime(c, config.PLAYER, 600)).toBe(c.deployDelay);
    }
  });

  it("the unit remembers its own arrival, so the animation matches", () => {
    // The renderer draws the elapsed fraction. Reading the card's flat value
    // would make a short throw appear to hang in the air.
    const m = new Match(4);
    m.hand[config.PLAYER][0] = byId("voltorb")!;
    m.elixir[config.PLAYER] = 10;
    m.deploy(config.PLAYER, 0, 190, 120);
    const far = m.units[m.units.length - 1];
    expect(far.arriveTime).toBeCloseTo(far.spawning, 2);
    expect(far.arriveTime).toBeGreaterThan(1);
  });
});

describe("the deck is shuffled, and then it cycles", () => {
  const deck = () => [
    "charmander", "snorlax", "voltorb", "machop", "geodude", "eevee",
  ].map((id) => byId(id)!);

  it("does not deal the opening hand from the top of the saved deck", () => {
    // The bug this replaces: hand was deck[0..3], unshuffled, so slot order
    // was a secret guarantee. Across many seeds every card must be capable of
    // opening -- if slot 5 never appears in an opening hand, it is still fixed.
    const opened = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const m = new Match({ rng: seeded(seed), playerDeck: deck() });
      for (const c of m.hand[config.PLAYER]) {
        if (c) opened.set(c.id, (opened.get(c.id) ?? 0) + 1);
      }
    }
    for (const c of deck()) {
      expect(opened.get(c.id) ?? 0, `${c.id} never opened`).toBeGreaterThan(20);
    }
  });

  it("keeps every card exactly once -- a shuffle, not a redraw", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const m = new Match({ rng: seeded(seed), playerDeck: deck() });
      const ids = m.deck[config.PLAYER].map((c) => c.id).sort();
      expect(ids).toEqual(deck().map((c) => c.id).sort());
    }
  });

  it("does not disturb the deck it was handed", () => {
    // The array belongs to the caller -- in multiplayer it is the deck the
    // client sent. Shuffling it in place would reorder somebody else's data.
    const original = deck();
    const before = original.map((c) => c.id);
    new Match({ rng: seeded(7), playerDeck: original });
    expect(original.map((c) => c.id)).toEqual(before);
  });

  it("deals the same match from the same seed", () => {
    // Replays and an authoritative server both rest on this. Math.random in
    // the shuffle would have cost both, silently.
    const hands = [1, 1].map((seed) =>
      new Match({ rng: seeded(seed), playerDeck: deck() })
        .hand[config.PLAYER].map((c) => c?.id));
    expect(hands[0]).toEqual(hands[1]);
  });

  it("still cycles, so counting the deck is still a skill", () => {
    // Shuffled once at the start, not drawn at random throughout. The order is
    // fixed from the first frame; only where it begins is hidden. So the fifth
    // and sixth cards of the shuffled deck are the next two to arrive, in that
    // order -- which is the whole basis of knowing what your opponent holds.
    //
    // Only the first two draws are checked, deliberately: playing a card
    // advances it toward evolving, and an evolution rewrites the deck in
    // place. Asserting further would be asserting that evolution does not
    // happen, which is a different and untrue claim.
    const m = new Match({ rng: seeded(3), playerDeck: deck() });
    const order = m.deck[config.PLAYER].map((c) => c.id);
    m.elixir[config.PLAYER] = 99;

    m.deploy(config.PLAYER, 0, 190, 500);
    expect(m.hand[config.PLAYER][0]!.id).toBe(order[4]);

    m.elixir[config.PLAYER] = 99;
    m.deploy(config.PLAYER, 1, 190, 500);
    expect(m.hand[config.PLAYER][1]!.id).toBe(order[5]);
  });

  it("an evolution keeps its place in the cycle", () => {
    // Evolving must not reshuffle anything. `replaceCard` swaps the card at
    // the index it already occupied, in the deck and in the hand, so the cycle
    // a player has been counting stays true across the evolution -- the card
    // at that position simply became stronger.
    //
    // The alternative -- removing and appending -- would silently move the
    // evolved card to the back, and the count everyone had been keeping would
    // be wrong from that moment with nothing on screen to say why.
    const m = new Match({ rng: seeded(11), playerDeck: deck() });
    const before = m.deck[config.PLAYER].map((c) => c.id);
    const target = m.deck[config.PLAYER][0];
    const at = before.indexOf(target.id);

    const next = evolution.evolve(target);
    expect(next, `${target.id} has nothing to evolve into`).toBeTruthy();
    hand.replaceCard(m, config.PLAYER, target, next!);

    const after = m.deck[config.PLAYER].map((c) => c.id);
    expect(after).toHaveLength(before.length);
    expect(after[at]).toBe(next!.id);
    // Every other position is untouched.
    for (let i = 0; i < before.length; i++) {
      if (i !== at) expect(after[i], `slot ${i} moved`).toBe(before[i]);
    }
  });

  it("the play that evolves a card still draws", () => {
    // Evolving used to buy a free rotation as well as a stat increase: the
    // evolved card was swapped into the slot in place, the draw was skipped
    // because the slot no longer held what was played, and the player kept
    // their hand. Invisible on screen, and impossible to plan around.
    //
    // Now it cycles like everything else and comes round in its turn.
    const m = new Match({ playerDeck: deck(), shuffle: false });
    const P = config.PLAYER;
    const order = m.deck[P].map((c) => c.id);
    const need = evolution.playsNeeded(byId("charmander")!)!;

    // Play it whenever it comes round -- which is the point: it now has to
    // come round, where before it stayed in hand.
    let drew: string | undefined;
    let played = 0;
    for (let step = 0; step < 40 && played < need; step++) {
      m.elixir[P] = 99;
      const slot = m.hand[P].findIndex((c) => c && /charm/.test(c.id));
      if (slot < 0) { m.deploy(P, 0, 190, 500); continue; }
      m.deploy(P, slot, 190, 500);
      drew = m.hand[P][slot]?.id;
      played++;
    }
    expect(played, "never got to play it enough times").toBe(need);

    // It evolved -- in the deck, at the position it already held...
    expect(m.deck[P].map((c) => c.id)).toContain("charmeleon");
    expect(m.deck[P].map((c) => c.id).indexOf("charmeleon"))
      .toBe(order.indexOf("charmander"));
    // ...and the slot was refilled from the cycle, not with the evolution.
    expect(drew).not.toMatch(/charm/);
  });

  it("can be turned off, for tests that need a known hand", () => {
    const m = new Match({ playerDeck: deck(), shuffle: false });
    expect(m.hand[config.PLAYER].map((c) => c?.id))
      .toEqual(deck().slice(0, config.handSize).map((c) => c.id));
  });
});

describe("Deoxys chooses a body on every play", () => {
  const deoxys = () => byId("deoxys")!;

  it("offers four bodies, and nothing else does", () => {
    expect(deoxys().forms).toHaveLength(4);
    const others = cards.ALL.filter((c) => c.id !== "deoxys" && c.forms.length);
    expect(others).toEqual([]);
  });

  it("deploys as the body chosen", () => {
    for (const form of ["deoxysattack", "deoxysdefense", "deoxysspeed"]) {
      const m = new Match(4);
      m.hand[config.PLAYER][0] = deoxys();
      m.elixir[config.PLAYER] = 10;
      hand.chooseForm(m, config.PLAYER, deoxys(), form);
      m.deploy(config.PLAYER, 0, 190, 500);
      expect(m.units[m.units.length - 1].card.id).toBe(form);
    }
  });

  it("falls back to the all-rounder when nothing is chosen", () => {
    const m = new Match(4);
    m.hand[config.PLAYER][0] = deoxys();
    m.elixir[config.PLAYER] = 10;
    m.deploy(config.PLAYER, 0, 190, 500);
    expect(m.units[m.units.length - 1].card.id).toBe("deoxys");
  });

  it("asks again on the next play", () => {
    // The decision is the card. A choice that stuck would silently apply to the
    // next Deoxys as well, which is the one thing this must not do.
    const m = new Match(4);
    m.hand[config.PLAYER][0] = deoxys();
    m.elixir[config.PLAYER] = 10;
    hand.chooseForm(m, config.PLAYER, deoxys(), "deoxysspeed");
    m.deploy(config.PLAYER, 0, 190, 500);
    expect(m.form[config.PLAYER]).toBeUndefined();

    m.hand[config.PLAYER][0] = deoxys();
    m.elixir[config.PLAYER] = 10;
    m.deploy(config.PLAYER, 0, 190, 500);
    expect(m.units[m.units.length - 1].card.id).toBe("deoxys");
  });

  it("a second tap steps to the next body and wraps back to the base", () => {
    // The whole gesture: tapping the card again cycles rather than deselecting,
    // so choosing costs one tap and no screen space. Wrapping matters as much as
    // stepping -- without it there is no way back to the all-rounder except
    // dropping the card and picking it up again.
    const m = new Match(4);
    const seen: Array<string | undefined> = [];
    for (let i = 0; i < 5; i++) {
      hand.cycleForm(m, config.PLAYER, deoxys());
      seen.push(m.form[config.PLAYER]);
    }
    expect(seen).toEqual([
      "deoxysattack", "deoxysdefense", "deoxysspeed", undefined, "deoxysattack",
    ]);
  });

  it("the base is only ever stored as undefined", () => {
    // Two spellings of the default is how the choice would come to leak between
    // cards: deploy clears the field, and a stored "deoxys" would not compare
    // equal to cleared.
    const m = new Match(4);
    for (let i = 0; i < 8; i++) {
      hand.cycleForm(m, config.PLAYER, deoxys());
      expect(m.form[config.PLAYER]).not.toBe("deoxys");
    }
  });

  it("cycling does nothing to a card with one body", () => {
    const m = new Match(4);
    hand.cycleForm(m, config.PLAYER, byId("charmander")!);
    expect(m.form[config.PLAYER]).toBeUndefined();
  });

  it("deploys whatever the cycle last landed on", () => {
    // The rule and the gesture agreeing is the actual claim. Two taps means
    // Attack, and two taps has to *deploy* Attack.
    const m = new Match(4);
    m.hand[config.PLAYER][0] = deoxys();
    m.elixir[config.PLAYER] = 10;
    hand.cycleForm(m, config.PLAYER, deoxys());
    hand.cycleForm(m, config.PLAYER, deoxys());
    m.deploy(config.PLAYER, 0, 190, 500);
    expect(m.units[m.units.length - 1].card.id).toBe("deoxysdefense");
  });

  it("costs the same elixir whichever body is chosen", () => {
    // The card face prints the hand card's price, so the price has to be the
    // hand card's. A form that charged its own number would make the badge lie.
    const m = new Match(4);
    const base = m.costOf(config.PLAYER, deoxys());
    for (const form of deoxys().forms) {
      const one = new Match(4);
      one.hand[config.PLAYER][0] = deoxys();
      one.elixir[config.PLAYER] = base;
      hand.chooseForm(one, config.PLAYER, deoxys(), form);
      expect(one.deploy(config.PLAYER, 0, 190, 500)).toBe(true);
      expect(one.elixir[config.PLAYER]).toBeCloseTo(0, 5);
    }
  });

  it("refuses a body the card does not offer", () => {
    // Or a stale choice follows a player onto a different card.
    const m = new Match(4);
    hand.chooseForm(m, config.PLAYER, deoxys(), "charmander");
    expect(m.form[config.PLAYER]).toBeUndefined();
  });

  it("the four are genuinely different cards", () => {
    const built = deoxys().forms.map((f) => byId(f) ?? cards.build(f)!);
    const speeds = new Set(built.map((c) => c.speed.toFixed(1)));
    const reaches = new Set(built.map((c) => c.range));
    expect(speeds.size).toBeGreaterThan(2);
    expect(reaches.size).toBeGreaterThan(1);
  });

  it("the speed form is the fastest thing on the board", () => {
    // Its whole identity. Derivation said otherwise: RUNNER_SPEED_BONUS applies
    // only to melee runners, so plain Deoxys took it and the Speed form, being
    // ranged, did not -- leaving the fast one second fastest of the four.
    const speed = cards.build("deoxysspeed")!;
    for (const c of cards.ALL) {
      expect(speed.speed, `${c.id} is faster`).toBeGreaterThanOrEqual(c.speed);
    }
  });
});

describe("both sides fight a tower the same way", () => {
  it("neither has to walk around the side to reach it", () => {
    // Collision held units off an asymmetric box -- a tower's art is a spire
    // with a staircase, so it reaches further below the centre than above --
    // while range measured to a symmetric circle. A creature held off by the
    // 57-unit staircase was outside a circle of 32 and could not swing, so it
    // slid around the side to find range. The one coming down stood square.
    // Reported as "my pokemon has to go left or right to attack, enemy pokemon
    // are correct straight up to tower".
    for (const side of [config.PLAYER, config.ENEMY] as const) {
      const m = new Match(3);
      const foe = side === config.PLAYER ? config.ENEMY : config.PLAYER;
      const t = m.towers.find(
        (x) => x.side === foe && x.kind === "side" && x.x < 192)!;
      const u = spawn(m, byId("charmander")!, side,
        t.x, t.y + (side === config.PLAYER ? 90 : -90));
      u.spawning = 0;
      for (let i = 0; i < 30 * 25 && !u.dead; i++) m.update(1 / 30);

      expect(Math.abs(u.x - t.x), `${side} drifted sideways`).toBeLessThan(8);
      expect(t.hp, `${side} never landed a hit`).toBeLessThan(t.maxHP);
    }
  });

  it("measures range to the same shape collision uses", () => {
    // One definition for both halves. A circle for range and a rectangle for
    // collision is the same class of bug this project keeps producing.
    const m = new Match(3);
    const t = m.towers.find((x) => x.kind === "side")!;
    const box = boxOf(t);
    const half = config.towerSize.side * 0.5;

    // Directly against the lower face: touching, so zero gap.
    expect(gapTo({ x: t.x, y: t.y + box.down }, t)).toBeCloseTo(0, 1);
    // And against the upper face, which is nearer because the art is.
    expect(gapTo({ x: t.x, y: t.y - box.up }, t)).toBeCloseTo(0, 1);
    // Beside it, at the footprint's edge.
    expect(gapTo({ x: t.x + half, y: t.y }, t)).toBeCloseTo(0, 1);
  });
});

/**
 * Arriving is not being there.
 *
 * Reported from play: "Diglett got attacked before it can deploy". Every other
 * targeting path in the game already skips a unit whose arrival is still
 * running -- a tunneller under the ground, a thrown ball mid-arc, a Snorlax in
 * the air. Towers did not, so the one card whose whole idea is to appear
 * somewhere awkward was shot on the way in and could be answered before the
 * player had finished placing it.
 *
 * Both engines had it, identically, which is exactly why the differential
 * suite never noticed: they agreed on the wrong answer.
 */
describe("a unit that has not arrived yet", () => {
  const deliveredCard = () => byId("diglett")!;

  /** A match with one tunneller landing right under an enemy tower. */
  function tunnellingUnderATower() {
    const m = new Match({
      playerDeck: cards.newDeck(seeded(7)), enemyDeck: cards.newDeck(seeded(8)),
      rng: seeded(9),
    });
    const tower = m.towers.find((t) => t.side === config.ENEMY && t.kind === "side")!;
    // Just clear of the tower's own box -- 20 would be *inside* it, and a unit
    // surfacing there is immediately shoved out, which is correct and makes a
    // poor thing to assert a destination against. Still deep inside its range.
    const at = { x: tower.x, y: tower.y + 70 };
    const u = spawn(m, deliveredCard(), config.PLAYER, at.x, at.y);
    return { m, tower, at, u: u as Unit };
  }

  it("sets off from its own king, not from where it was played", () => {
    // Clash Royale's Miner: you choose where it comes up, not where it starts.
    const { u, m } = tunnellingUnderATower();
    const king = m.towers.find((t) => t.side === config.PLAYER && t.kind === "king")!;
    expect(u.x).toBeCloseTo(king.x, 0);
    expect(u.y).toBeCloseTo(king.y, 0);
    expect(u.spawning).toBeGreaterThan(0);
  });

  it("is timed by how far it has to dig", () => {
    const { u, at } = tunnellingUnderATower();
    expect(u.spawning)
      .toBeCloseTo(arrivalTime(deliveredCard(), config.PLAYER, at.y, at.x), 5);
  });

  it("crosses the whole board and comes up where it was asked to", () => {
    const { m, u, at } = tunnellingUnderATower();
    while (u.spawning > 0) m.update(STEP);
    expect(u.x).toBeCloseTo(at.x, 0);
    expect(u.y).toBeCloseTo(at.y, 0);
  });

  it("cannot be shot at any point of the journey", () => {
    // It digs from its own king to under an enemy tower, so the last stretch
    // of the trip is spent well inside that tower's range.
    const { m, u } = tunnellingUnderATower();
    const full = u.hp;
    while (u.spawning > 0) {
      m.update(STEP);
      if (u.spawning > 0) expect(u.hp).toBe(full);
    }
    expect(u.hp).toBe(full);
  });

  it("is shot at once it has surfaced", () => {
    // The other half of the rule. Without this, "never take damage" would pass.
    const { m, u } = tunnellingUnderATower();
    const full = u.hp;
    for (let i = 0; i < 300; i++) m.update(STEP);

    expect(u.spawning).toBeLessThanOrEqual(0);
    expect(u.hp).toBeLessThan(full);
  });
});

/**
 * A target is kept until it dies or leaves reach. Nothing else takes it.
 *
 * Reported from play: "why my dugtrio attacking tower then it switch to other
 * pokemon?". Being hit used to pull a creature off a tower, which is a second
 * rule for choosing targets and contradicts the first one.
 */
describe("what makes a creature change its mind", () => {
  /** A creature locked onto an enemy crown tower, and an enemy beside it. */
  function swingingAtATower() {
    const m = new Match({
      playerDeck: cards.newDeck(seeded(11)), enemyDeck: cards.newDeck(seeded(12)),
      rng: seeded(13),
    });
    const tower = m.towers.find((t) => t.side === config.ENEMY && t.kind === "side")!;
    const mine = spawn(m, byId("machop")!, config.PLAYER, tower.x, tower.y + 70) as Unit;
    mine.spawning = 0;
    // Given enough health to survive the experiment: the point is what it
    // chooses to hit, not whether it outlives a tower plus a Machop.
    mine.maxHP = 100_000;
    mine.hp = mine.maxHP;
    // Something of theirs, right next to it.
    const theirs = spawn(m, byId("machop")!, config.ENEMY, tower.x + 14, tower.y + 70) as Unit;
    theirs.spawning = 0;
    return { m, tower, mine, theirs };
  }

  it("keeps hitting the tower even while something else hits it", () => {
    const { m, tower, mine, theirs } = swingingAtATower();
    // Lock it on.
    mine.target = tower;
    for (let i = 0; i < 60; i++) {
      // Their creature lands blows on mine the whole time.
      applyHit(m, mine, 3, 1, theirs);
      m.update(STEP);
      if (mine.dead || tower.dead) break;
    }
    expect(mine.dead).toBe(false);
    expect(mine.target?.isTower ?? false).toBe(true);
  });

  it("stops for something in its path on the way to a tower", () => {
    /*
     * From a screenshot: an enemy walked straight through a defender -- gap
     * zero, neither one swinging -- because it had locked the tower five tiles
     * back and never looked again.
     *
     * Holding a target is for a creature that is *fighting*. One that is only
     * walking towards its target is still shopping, and the nearest thing
     * wins.
     */
    const m = new Match({
      playerDeck: cards.newDeck(seeded(21)), enemyDeck: cards.newDeck(seeded(22)),
      rng: seeded(23),
    });
    const tower = m.towers.find((t) => t.side === config.PLAYER && t.kind === "side")!;
    const theirs = spawn(m, byId("charmander")!, config.ENEMY, tower.x, tower.y - 120) as Unit;
    theirs.spawning = 0;
    theirs.target = tower;                        // locked on from far away
    const blocker = spawn(m, byId("charmander")!, config.PLAYER, tower.x, tower.y - 90) as Unit;
    blocker.spawning = 0;
    const full = blocker.hp;

    for (let i = 0; i < 60; i++) m.update(STEP);

    expect(theirs.target).not.toBe(tower);
    expect(blocker.hp).toBeLessThan(full);
  });

  it("does look at whatever hit it when it had nothing to hit", () => {
    // The half of the old rule worth keeping: being shot from out of nowhere
    // still earns a creature's attention when it is not already busy.
    const { m, mine, theirs } = swingingAtATower();
    mine.target = undefined;
    applyHit(m, mine, 3, 1, theirs);
    expect(mine.target).toBe(theirs);
  });

  it("lets go once the tower is gone", () => {
    const { m, tower, mine } = swingingAtATower();
    mine.target = tower;
    tower.hp = 1;
    for (let i = 0; i < 200 && !tower.dead; i++) m.update(STEP);
    expect(tower.dead).toBe(true);
    // And a few frames past the kill, or it has not yet had a tick in which
    // to notice -- which would make this test pass for the wrong reason.
    for (let i = 0; i < 3; i++) m.update(STEP);
    // Not "no longer a tower" -- the next thing it picks may well be another
    // one. What matters is that it stopped hitting the dead one.
    expect(mine.target).not.toBe(tower);
  });
});

/**
 * Caught between a tower and a creature: which does it go for?
 *
 * There is no "towers first" rule and no "creatures first" rule -- both are
 * candidates competing on distance, and the nearest wins. Worth pinning down,
 * because it is the question every player asks when a push walks past their
 * defender, and because the tie-break is not obvious: towers are measured to
 * their edge rather than their centre, and are checked second.
 */
describe("choosing between a tower and a creature", () => {
  /** My creature, an enemy tower, and an enemy creature I can place. */
  function between(unitDistance: number) {
    const m = new Match({
      playerDeck: cards.newDeck(seeded(31)), enemyDeck: cards.newDeck(seeded(32)),
      rng: seeded(33),
    });
    const tower = m.towers.find((t) => t.side === config.ENEMY && t.kind === "side")!;
    // Standing well below the tower. 120 rather than 60, because a tower is
    // measured to the edge of its box and that box reaches 57 units down --
    // at 60 the gap is 3, and no creature can be nearer than that.
    const me = spawn(m, byId("machop")!, config.PLAYER, tower.x, tower.y + 120) as Unit;
    me.spawning = 0;
    // The enemy creature directly behind me, at the distance asked for.
    const them = spawn(
      m, byId("machop")!, config.ENEMY, tower.x, me.y + unitDistance) as Unit;
    them.spawning = 0;
    return { m, me, them, tower, toTower: gapTo(me, tower) };
  }

  it("goes for the creature when the creature is nearer", () => {
    const { m, me, them, toTower } = between(20);
    expect(20).toBeLessThan(toTower);           // the setup is what we think
    expect(findTarget(m, me, me.aggro)).toBe(them);
  });

  it("still goes for the creature even when the tower is nearer", () => {
    /*
     * This asserted the opposite until it was reported from play, twice: a
     * tower is measured to the edge of its box, so it reads as nearer than a
     * defender standing beside you, and attackers walked past the creature
     * sent to stop them. A tower is now the fallback rather than a competitor.
     */
    const { m, me, them, toTower } = between(90);
    expect(toTower).toBeLessThan(90);            // the tower really is nearer
    expect(findTarget(m, me, me.aggro)).toBe(them);
  });

  it("goes for the tower when nothing of theirs is in sight", () => {
    const { m, me, them, tower } = between(20);
    them.dead = true;                            // the defender is gone
    expect(findTarget(m, me, me.aggro)).toBe(tower);
  });

  it("keeps hitting the tower when the tower is genuinely the nearest thing", () => {
    /*
     * Everything is measured centre to centre, including towers. `gapTo`
     * measures to the edge of a tower's box -- right for deciding whether you
     * can hit it, wrong for deciding what to go for, because a tower a tile
     * away then reads as nearer than a defender two tiles away.
     *
     * The consequence is worth stating plainly: a defender has to get quite
     * close to pull a creature off a tower it is standing against, because the
     * tower's centre is only about two tiles away at that point. That is the
     * rule doing what it says, not an exception.
     */
    const m = new Match({
      playerDeck: cards.newDeck(seeded(41)), enemyDeck: cards.newDeck(seeded(42)),
      rng: seeded(43),
    });
    const tower = m.towers.find((t) => t.side === config.ENEMY && t.kind === "side")!;
    const me = spawn(m, byId("machop")!, config.PLAYER, tower.x, tower.y + 65) as Unit;
    me.spawning = 0;
    expect(gapTo(me, tower)).toBeLessThanOrEqual(me.range);        // in reach

    // Their creature further away than the tower's centre.
    const them = spawn(m, byId("eevee")!, config.ENEMY, tower.x + 100, tower.y + 130) as Unit;
    them.spawning = 0;
    expect(Math.hypot(them.x - me.x, them.y - me.y))
      .toBeGreaterThan(Math.hypot(tower.x - me.x, tower.y - me.y));

    expect(findTarget(m, me, me.aggro)).toBe(tower);
  });

  it("gives a dead-heat to the creature", () => {
    // Creatures outrank towers outright now, so a tie is not even close.
    const probe = between(0);
    const { m, me, them } = between(probe.toTower);
    expect(findTarget(m, me, me.aggro)).toBe(them);
  });

  it("ignores both when they are outside what it can notice", () => {
    const { m, me } = between(500);
    // The tower is behind it and far; nothing is in sight at all.
    const far = new Match({
      playerDeck: cards.newDeck(seeded(34)), enemyDeck: cards.newDeck(seeded(35)),
      rng: seeded(36),
    });
    const lonely = spawn(far, byId("machop")!, config.PLAYER, 200, 400) as Unit;
    lonely.spawning = 0;
    expect(findTarget(far, lonely, lonely.aggro)).toBeUndefined();
    expect(me.aggro).toBeGreaterThan(0);
  });
});
