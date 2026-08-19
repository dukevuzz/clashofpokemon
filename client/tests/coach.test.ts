/**
 * What a first-time player is told, and when.
 *
 * The rules are pure -- a trigger read off a live match, a line, and a way to
 * be finished -- so they can be checked without a canvas. What matters is that
 * nothing is said before it is relevant, nothing repeats, and a player who
 * already does the right thing is never told to do it.
 */

import { describe, expect, it } from "vitest";
import { Match } from "../src/core/match";
import { config } from "../src/core/config";
import * as cards from "../src/core/cards";
import { spawn } from "../src/core/deploy";
import { nextStep, STEPS } from "../src/ui/coach";

const fresh = () =>
  new Match({ playerDeck: cards.newDeck(), enemyDeck: cards.newDeck() });

const card = (id: string) => cards.byId(id) ?? cards.build(id, cards.byId("machop")!)!;

describe("coaching a first match", () => {
  it("opens by asking for a card, and shows where it may go", () => {
    const step = nextStep(fresh(), config.PLAYER, new Set());
    expect(step?.id).toBe("deploy");
    expect(step?.showZone).toBe(true);
  });

  it("stops asking once a card is on the board", () => {
    const m = fresh();
    const retired = new Set<string>();
    expect(nextStep(m, config.PLAYER, retired)?.id).toBe("deploy");

    const u = spawn(m, card("machop"), config.PLAYER, 150, 500) as any;
    u.spawning = 0;
    expect(nextStep(m, config.PLAYER, retired)?.id).not.toBe("deploy");
  });

  it("says something is coming only when something actually is", () => {
    // Two separate matches, because asking the question retires any step that
    // is already satisfied -- checking "not yet" and then "now" on one match
    // retires `defend` before the second half of the test can see it.
    const quiet = fresh();
    const retired = new Set(["deploy", "hands-off", "elixir"]);
    expect(nextStep(quiet, config.PLAYER, retired)?.id).not.toBe("defend");

    const threatened = fresh();
    // Side one defends the bottom half, so theirs is a threat past y = 336.
    const them = spawn(threatened, card("machop"), config.ENEMY, 150, 500) as any;
    them.spawning = 0;
    expect(nextStep(threatened, config.PLAYER,
      new Set(["deploy", "hands-off", "elixir"]))?.id).toBe("defend");
  });

  it("warns about full elixir only when it is full", () => {
    // Again two matches: a step that is satisfied when asked is retired, so
    // the low-elixir check would consume the very line being tested.
    const spent = fresh();
    spent.elixir[config.PLAYER] = 4;
    expect(nextStep(spent, config.PLAYER, new Set(["deploy", "hands-off"]))?.id)
      .not.toBe("elixir");

    const full = fresh();
    full.elixir[config.PLAYER] = config.elixirMax;
    expect(nextStep(full, config.PLAYER, new Set(["deploy", "hands-off"]))?.id)
      .toBe("elixir");
  });

  it("never repeats a line it has already retired", () => {
    const m = fresh();
    const retired = new Set<string>();
    const first = nextStep(m, config.PLAYER, retired)!;
    retired.add(first.id);
    // Same match, same state: it must move on rather than say it again.
    expect(nextStep(m, config.PLAYER, retired)?.id).not.toBe(first.id);
  });

  it("says nothing at all once every line is retired", () => {
    const m = fresh();
    const retired = new Set(STEPS.map((s) => s.id));
    expect(nextStep(m, config.PLAYER, retired)).toBeUndefined();
  });

  it("skips a lesson the player has already learned", () => {
    // A card is already down, so "drag a Pokemon onto your half" is not a
    // thing to teach -- it is retired without ever being shown.
    const m = fresh();
    const u = spawn(m, card("machop"), config.PLAYER, 150, 500) as any;
    u.spawning = 0;
    const retired = new Set<string>();
    nextStep(m, config.PLAYER, retired);
    expect(retired.has("deploy")).toBe(true);
  });

  it("mentions double elixir in the last minute", () => {
    const m = fresh();
    const retired = new Set(["deploy", "hands-off", "elixir", "defend", "lane-open"]);
    expect(nextStep(m, config.PLAYER, retired)?.id).not.toBe("double");
    m.time = config.suddenDeathAt;
    expect(nextStep(m, config.PLAYER, retired)?.id).toBe("double");
  });

  it("every line is short enough to read mid-match", () => {
    for (const s of STEPS) expect(s.text.length).toBeLessThanOrEqual(64);
  });
});
