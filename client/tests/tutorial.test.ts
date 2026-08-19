/**
 * The scripted tutorial's content.
 *
 * The lessons are data -- a hand, a line, and a test for having done it -- so
 * they can be checked without a canvas. What matters is that every lesson can
 * actually be completed with the hand it gives you, and that the sequence is
 * coherent: no lesson asks for a card it did not deal.
 */

import { describe, expect, it } from "vitest";
import { Match } from "../src/core/match";
import { config } from "../src/core/config";
import * as cards from "../src/core/cards";
import * as evolution from "../src/core/evolution";
import { spawn } from "../src/core/deploy";
import { LESSONS } from "../src/ui/tutorial";

const fresh = () =>
  new Match({ playerDeck: cards.newDeck(), enemyDeck: cards.newDeck() });

describe("the tutorial's lessons", () => {
  it("names a real card in every hand", () => {
    for (const lesson of LESSONS) {
      for (const id of lesson.hand) {
        expect(cards.byId(id) ?? cards.build(id), `${lesson.id} deals ${id}`).toBeTruthy();
      }
    }
  });

  it("spawns only real cards", () => {
    for (const lesson of LESSONS) {
      for (const s of lesson.spawn ?? []) {
        expect(cards.byId(s.card), `${lesson.id} spawns ${s.card}`).toBeTruthy();
      }
    }
  });

  it("starts undone on a fresh board", () => {
    // A lesson that is already satisfied would be skipped without teaching
    // anything -- which is how a player ends up at the end having done nothing.
    const m = fresh();
    for (const lesson of LESSONS) {
      if (lesson.id === "defend") continue;      // needs its spawn to be untrue
      expect(lesson.done(m, config.PLAYER), `${lesson.id} starts undone`).toBe(false);
    }
  });

  it("can be completed with the card it deals", () => {
    // Every lesson whose test is "you played this" must deal that card.
    for (const lesson of LESSONS) {
      const m = fresh();
      const card = cards.byId(lesson.hand[0]) ?? cards.build(lesson.hand[0])!;
      const u = spawn(m, card, config.PLAYER, 150, 500) as any;
      u.spawning = 0;
      if (["deploy", "forms", "tunnel"].includes(lesson.id)) {
        expect(lesson.done(m, config.PLAYER), `${lesson.id} completes`).toBe(true);
      }
    }
  });

  it("teaches the evolution lesson with a card that actually evolves", () => {
    const evolve = LESSONS.find((l) => l.id === "evolve")!;
    const chain = evolution.chainOf(evolve.hand[0]);
    expect(chain.length).toBeGreaterThan(1);
  });

  it("teaches forms with a card that actually has them", () => {
    const forms = LESSONS.find((l) => l.id === "forms")!;
    const card = cards.byId(forms.hand[0])!;
    expect(card.forms.length).toBeGreaterThan(0);
  });

  it("teaches tunnelling with a card that actually tunnels", () => {
    const tunnel = LESSONS.find((l) => l.id === "tunnel")!;
    expect(cards.byId(tunnel.hand[0])!.delivery).toBe("tunnel");
  });

  it("keeps every line short enough to read mid-match", () => {
    for (const l of LESSONS) {
      expect(l.text.length, `${l.id}: ${l.text}`).toBeLessThanOrEqual(88);
      if (l.after) expect(l.after.length).toBeLessThanOrEqual(88);
    }
  });

  it("has no duplicate ids", () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
