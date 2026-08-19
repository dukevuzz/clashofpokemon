/**
 * Every creature that can reach the board has art fetched for it.
 *
 * The failure this guards is quiet and ugly: Phaser answers a request for a
 * texture it does not have with a placeholder -- a black box with a green
 * border and a diagonal -- and draws it on the board at the creature's feet.
 * Nothing throws, nothing logs, and the match plays on with a black square
 * fighting a Charmander.
 *
 * It shipped because `chainOf` answers "what does this evolve into" and the
 * loader treated that as "everything this card can become". A *form* is the
 * other axis: a body the card is deployed as, which Deoxys has three of, each
 * with its own sheet, none of them in any chain.
 */

import { describe, it, expect } from "vitest";
import * as cards from "../src/core/cards";
import * as evolution from "../src/core/evolution";
import { SHEETS } from "../src/data/sheets";

/** Exactly what BattleScene.preload walks, kept in step with it by hand. */
function reachableFrom(deck: cards.Card[]): string[] {
  return deck.flatMap((c) => {
    const chain = evolution.chainOf(c.id) ?? [c.id];
    const forms = chain.flatMap((id) => cards.byId(id)?.forms ?? []);
    return [...chain, ...forms];
  });
}

describe("art is fetched for everything a deck can put on the board", () => {
  it("covers forms, not just evolutions", () => {
    const deoxys = cards.byId("deoxys")!;
    const got = new Set(reachableFrom([deoxys]));
    for (const form of deoxys.forms) {
      expect(got.has(form), `${form} would render as a missing texture`).toBe(true);
    }
    // And the thing that made this invisible: forms are in no chain.
    expect(evolution.chainOf("deoxys")).not.toContain("deoxysattack");
  });

  it("every reachable card has a sheet that exists", () => {
    // Sweep the whole roster rather than one deck: any card can be drawn.
    const missing: string[] = [];
    for (const c of cards.ALL) {
      for (const id of reachableFrom([c])) {
        const card = cards.byId(id) ?? cards.build(id);
        if (!card) { missing.push(`${id} (no card)`); continue; }
        if (!(card.sheet in SHEETS)) missing.push(`${id} -> ${card.sheet}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("a form's sheet is its own, not its base's", () => {
    // If forms shared the base sheet this whole class of bug could not exist --
    // and the fix would be unnecessary. They do not, so it can, and it is.
    const base = cards.byId("deoxys")!;
    for (const id of base.forms) {
      if (id === base.id) continue;
      const form = cards.byId(id) ?? cards.build(id)!;
      expect(form.sheet).not.toBe(base.sheet);
      expect(form.sheet in SHEETS).toBe(true);
    }
  });
});
