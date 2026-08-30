/**
 * DISABLED, pending a rewrite against the DOM.
 *
 * Every check below reaches into a Phaser scene -- `getScene("Deck")`, then
 * `d.deck`, `d.tiles`, `d.refresh()`. The deck builder is a React screen now
 * and that scene no longer exists, so these cannot run.
 *
 * They are skipped rather than deleted because of what they are: each one
 * corresponds to a bug that actually shipped, and the list of those bugs is
 * worth more than the code that checks them. Deleting the file would throw
 * away the record of what to re-test. Rewriting them properly means driving
 * the same behaviours through the DOM -- a real piece of work, and a worse
 * one done in a hurry, because a paraphrased check that passes for the wrong
 * reason is worse than an honest gap.
 *
 * The behaviours still needing cover: a removed card must not come back as a
 * different card; emptying the deck must not hand six new ones back; the deck
 * screen must open; the collection grid must draw its creatures.
 */

import { test, expect } from "@playwright/test";
const OUT = "/tmp/claude-1000/-home-duc-Documents-duk-game/7b6e6169-d545-4e6b-84c7-d50ccaa74d69/scratchpad";

test.skip("the Mega slot is marked, and reordering works", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("clashofpokemon.deck",
      JSON.stringify(["charmander","zeraora","rowlet","sandile","gastly","zygarde"]));
  });
  await page.goto("http://localhost:5173/");
  await page.waitForFunction(() => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  await page.evaluate(() => (window as any).lr.scene.getScene("Menu").scene.start("Deck"));
  await page.waitForFunction(() => (window as any).lr?.scene.getScene("Deck")?.sys.settings.status === 5, undefined, {timeout:30000});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/deck-mega-on.png` });

  // A slot-one card that cannot Mega: the glow should go flat, not vanish.
  await page.evaluate(async () => {
    const d = (window as any).lr.scene.getScene("Deck");
    const cards = await import("/src/core/cards.ts");
    d.deck = [cards.build("pikachu"), ...d.deck.slice(1)];
    d.refresh();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/deck-mega-off.png` });

  const order = await page.evaluate(async () => {
    const d = (window as any).lr.scene.getScene("Deck");
    const deckEdit = await import("/src/core/deckEdit.ts");
    const before = d.deck.map((c: any) => c?.id ?? null);
    d.deck = deckEdit.moveSlot(d.deck, 4, 0);
    d.refresh();
    return { before, after: d.deck.map((c: any) => c?.id ?? null) };
  });
  expect(order.after[0]).toBe(order.before[4]);
  expect(order.after).toHaveLength(6);
});
