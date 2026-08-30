/**
 * The mutation recorder.
 *
 * It exists to answer "is the protocol complete", so its own correctness
 * matters more than usual: a recorder that silently collapsed two different
 * actions into one would report full coverage of a message set with a hole in
 * it, and the hole would be found by a player instead.
 */

import { describe, it, expect } from "vitest";
import { recorder, type Action } from "../src/core/trace";
import { Match, config } from "../src/core";
import * as cards from "../src/core/cards";

const act = (name: string, reach: Action["reach"], at = 1): Action =>
  ({ name, reach, at });

describe("recording what a match did", () => {
  it("counts occurrences rather than keeping them", () => {
    // A match emits hundreds of thousands of actions and there are perhaps
    // thirty kinds. Collecting them all would answer the same question and
    // exhaust the heap doing it.
    const rec = recorder();
    for (let i = 0; i < 500; i++) rec.trace(act("unit.move", "continuous", i));
    const rows = rec.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(500);
  });

  it("keeps the first and last of each kind", () => {
    const rec = recorder();
    rec.trace(act("unit.move", "continuous", 10));
    rec.trace(act("unit.move", "continuous", 20));
    const row = rec.rows()[0];
    expect(row.first.at).toBe(10);
    expect(row.last.at).toBe(20);
  });

  it("keeps different actions apart", () => {
    const rec = recorder();
    rec.trace(act("unit.move", "continuous"));
    rec.trace(act("unit.spawn", "discrete"));
    rec.trace(act("form.cycle", "local"));
    expect(rec.rows().map((r) => r.name).sort())
      .toEqual(["form.cycle", "unit.move", "unit.spawn"]);
  });

  it("groups by how an action must reach the other end", () => {
    // The whole point of the report: discrete needs its own message,
    // continuous must be sampled, local never leaves.
    const rec = recorder();
    rec.trace(act("z.local", "local"));
    rec.trace(act("a.discrete", "discrete"));
    rec.trace(act("m.continuous", "continuous"));
    expect(rec.rows().map((r) => r.reach))
      .toEqual(["continuous", "discrete", "local"]);
  });

  it("reports nothing before anything happens", () => {
    expect(recorder().rows()).toEqual([]);
  });
});

describe("a match reports its own mutations", () => {
  it("says nothing when nobody is listening", () => {
    // Off by default and free when off: one undefined check per call site, on
    // paths that run 600 times a second.
    const m = new Match({ playerDeck: [], enemyDeck: [] });
    expect(() => m.update(1 / 30)).not.toThrow();
    expect(m.trace).toBeUndefined();
  });

  it("reports the clock and elixir every step", () => {
    const rec = recorder();
    const m = new Match({ trace: rec.trace });
    m.update(1 / 30);
    const names = rec.rows().map((r) => r.name);
    expect(names).toContain("clock.tick");
    expect(names).toContain("elixir.regen");
  });

  it("tags movement continuous and a spawn discrete", () => {
    const rec = recorder();
    // A pinned deck, not a dealt one. `newDeck` draws at random, so slot 0
    // could hold a card ten elixir cannot afford -- Ditto costs Infinity until
    // something has been played -- and then nothing spawns and this fails for
    // a reason that has nothing to do with tracing. It did, about once in two
    // hundred runs, which is exactly often enough to be blamed on the wrong
    // change.
    const cheap = cards.ALL
      .filter((c) => Number.isFinite(c.elixir) && c.elixir <= 3)
      .slice(0, config.deckSize);
    const m = new Match({ trace: rec.trace, playerDeck: cheap, enemyDeck: cheap });
    m.elixir[config.PLAYER] = 10;
    m.deploy(config.PLAYER, 0, 190, 500);
    for (let i = 0; i < 120; i++) m.update(1 / 30);

    const by = new Map(rec.rows().map((r) => [r.name, r]));
    expect(by.get("unit.spawn")?.reach).toBe("discrete");
    expect(by.get("unit.move")?.reach).toBe("continuous");
    // And movement is by far the loudest thing the match does, which is why it
    // is sampled into snapshots rather than sent as events.
    expect(by.get("unit.move")!.count)
      .toBeGreaterThan(by.get("unit.spawn")!.count);
  });

  it("records a refused deploy as its own action", () => {
    const rec = recorder();
    const m = new Match({ trace: rec.trace });
    m.elixir[config.PLAYER] = 0;
    m.deploy(config.PLAYER, 0, 190, 500);
    expect(rec.rows().map((r) => r.name)).toContain("deploy.refuse");
  });

  it("does not change what the match does", () => {
    // A match that plays differently while observed is worse than no
    // observation. Same seed, same outcome, trace on or off.
    const seeded = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const play = (trace?: ReturnType<typeof recorder>["trace"]) => {
      const m = new Match({ rng: seeded(5), trace });
      for (let i = 0; i < 400; i++) m.update(1 / 30);
      return m.towers.map((t) => t.hp);
    };
    expect(play(recorder().trace)).toEqual(play(undefined));
  });
});
