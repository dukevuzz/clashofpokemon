/**
 * The match clock belongs to the match.
 *
 * This is a source-level test, which is unusual here and deliberate. The bug it
 * guards was not a wrong value anywhere in `core/` -- every rule was correct.
 * `BattleScene.update` simply declined to *call* the rules while a dialog was
 * open:
 *
 *     if (!this.match.over && !this.choiceUI) { ...step the simulation... }
 *
 * So the game was pausable by opening the evolution picker. Elixir stopped
 * filling, creatures stopped walking, and the player could read the board for as
 * long as they liked. Against a local bot that is merely generous. Against
 * another person it is the whole match: whoever evolves gets to stop time, and
 * two clients stepping different amounts of simulation cannot agree on what
 * happened at all.
 *
 * There is no value to assert instead, because the defect is an *absence* -- a
 * step that did not run. A unit test needs a scene, a scene needs Phaser, and
 * Phaser needs a browser; the Playwright suite has one but cannot reliably drive
 * a branching evolution to the moment it fires. Reading the gate is the cheapest
 * honest check that the renderer has not quietly acquired a rule again.
 *
 * If `update` is refactored and this fails, the question to ask is not "how do I
 * make the string match" -- it is "can anything other than the match ending stop
 * the simulation now".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = "src/scenes/BattleScene.ts";

/** The body of `update`, up to the next method at the same indentation. */
function updateBody(): string {
  const src = readFileSync(SRC, "utf8");
  const start = src.search(/\n {2}override update\(/);
  expect(start, `${SRC} no longer declares an update() method`)
    .toBeGreaterThan(-1);
  const after = src.slice(start);
  // Methods here are all indented two spaces, so the next `\n  private ` or
  // `\n  override ` ends this one.
  const end = after.slice(1).search(/\n {2}(private|override|public|\/\*\*)/);
  return end === -1 ? after : after.slice(0, end + 1);
}

describe("nothing but the match ending stops the match", () => {
  it("the simulation gate reads only the match", () => {
    const body = updateBody();
    // The accumulator loop must be entered on the strength of the match alone.
    expect(body).toContain("if (!this.match.over) {");
  });

  it("no UI state appears anywhere in the frame loop", () => {
    const body = updateBody();
    // choiceUI was the one that got in. Any of these would be the same mistake
    // wearing a different name: a screen deciding whether time passes.
    for (const ui of ["choiceUI", "banner", "preview", "dragging", "selected"]) {
      expect(body, `update() consults this.${ui} to decide whether to step`)
        .not.toContain(`this.${ui}`);
    }
  });

  it("time is taken from the wall clock, not from Phaser's loop", () => {
    // The second half of the same bug. Phaser pauses its own loop on
    // `visibilitychange` -- Game.onHidden calls loop.pause() -- so `delta`
    // reports nothing for the time a tab spent hidden. Reading it meant tabbing
    // away paused the match just as surely as the dialog did.
    const body = updateBody();
    expect(body).toContain("performance.now()");
    expect(body, "update() is billing the match by Phaser's paused delta")
      .not.toMatch(/\bdelta\b\s*\/\s*1000/);
  });

  it("what a tab owes is bounded by the match, not thrown away", () => {
    // It used to be capped at a quarter of a second, which is not a bound on
    // catch-up -- it is a bound on how much of the game you are allowed to miss
    // before the rest is silently forgiven. A match cannot outlast itself, so
    // the only honest ceiling is its own length.
    const src = readFileSync(SRC, "utf8");
    expect(src).toContain("const MAX_CATCHUP = config.matchSeconds;");
    expect(updateBody()).toContain("MAX_CATCHUP");
  });

  it("one frame cannot spend unbounded time catching up", () => {
    // Paying the whole debt at once is the other way to fail: a full match is
    // 5400 steps, and a phone drawing that in one frame is a lurch. The budget
    // is in real milliseconds so it adapts to the device rather than guessing.
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/const CATCHUP_BUDGET_MS = \d+;/);
    const body = updateBody();
    expect(body).toContain("CATCHUP_BUDGET_MS");
    // And the leftover must be kept, or the budget becomes the old cap again.
    expect(body).toMatch(/this\.accumulator -= SIM_STEP/);
  });
});

describe("catching up simulates the absence without performing it", () => {
  it("replays structural events and skips the merely decorative", () => {
    // A minute of absence is thousands of hits, shots and casts. Drawn, the
    // catch-up costs more in tweens than in simulation and describes a fight
    // that is already over. But a spawn makes a view and a death removes one:
    // skip those and the screen shows a game that is not being played.
    const src = readFileSync(SRC, "utf8");
    const set = src.slice(src.indexOf("const COSMETIC"));
    const listed = set.slice(0, set.indexOf("]"));
    for (const e of ["hit", "shot", "cast", "ready"]) {
      expect(listed, `${e} is redrawn for every step of the catch-up`)
        .toContain(`"${e}"`);
    }
    for (const e of ["spawn", "death", "over", "choice", "kingWakes"]) {
      expect(listed, `${e} is structural and must not be skipped`)
        .not.toContain(`"${e}"`);
    }
  });

  it("the skip is checked before anything is drawn", () => {
    const src = readFileSync(SRC, "utf8");
    const render = src.slice(src.indexOf("private render(e: MatchEvent) {"));
    const head = render.slice(0, render.indexOf("switch (e.type)"));
    expect(head).toContain("this.catchingUp && COSMETIC.has(e.type)");
  });

  it("a fresh match starts owing nothing", () => {
    // Left set across a rematch, the first frame bills the new match for the
    // time spent reading the old one's result screen.
    const src = readFileSync(SRC, "utf8");
    const create = src.slice(src.indexOf("  create() {"));
    const body = create.slice(0, create.indexOf("// ------"));
    expect(body).toContain("this.lastStepAt = 0;");
    expect(body).toContain("this.accumulator = 0;");
  });
});

describe("a dialog that opens during a match cannot swallow the board", () => {
  it("the evolution picker is non-blocking", () => {
    // It is the only dialog that opens while a match is running. Since the
    // clock no longer stops for it, one that dimmed the canvas and ate every
    // pointer would take time from the player without letting them spend it.
    const src = readFileSync(SRC, "utf8");
    const call = src.slice(src.indexOf("private showChoice("));
    const args = call.slice(0, call.indexOf("});"));
    expect(args).toContain("blocking: false");
    // And still has no default answer, so it cannot be dismissed by accident.
    expect(args).toContain("dismissable: false");
  });

  it("the non-blocking style lets the pointer through", () => {
    const css = readFileSync("public/ui.css", "utf8");
    const rule = css.slice(css.indexOf(".lr-passthrough {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("pointer-events: none");
    // The dialog itself must take its own clicks back, or it cannot be answered.
    const box = rule.slice(rule.indexOf(".lr-passthrough .lr-modal {"));
    expect(box.slice(0, box.indexOf("}"))).toContain("pointer-events: auto");
  });
});
