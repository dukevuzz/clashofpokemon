import { test, expect } from "@playwright/test";

test("the Mega button charges, fires, and swaps the sprite", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));

  await page.addInitScript(() => {
    localStorage.setItem("clashofpokemon.deck",
      JSON.stringify(["charmander", "pikachu", "squirtle", "bulbasaur", "abra", "gastly"]));
  });
  await page.goto("http://localhost:5173/");
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  await page.evaluate(() =>
    (window as any).lr.scene.getScene("Menu").scene.start("Battle", { seat: 1 }));
  await page.waitForFunction(() => {
    const b = (window as any).lr?.scene.getScene("Battle");
    return b?.sys.settings.status === 5;
  }, undefined, { timeout: 60_000 });

  const out = await page.evaluate(async () => {
    const b = (window as any).lr.scene.getScene("Battle");
    const cards = await import("/src/core/cards.ts");
    const mega = await import("/src/core/mega.ts");

    // A grown Charizard on the board, with the deck still holding Charmander.
    const deploy = await import("/src/core/deploy.ts");
    b.match.megaPick[b.me] = cards.build("charmander");
    const u = deploy.spawn(b.match, cards.build("charizard"), b.me, 190, 420);
    u.spawning = 0;

    b.match.elixir[b.me] = 0;
    const dry = mega.canMega(b.match, b.me);
    b.match.elixir[b.me] = 10;
    const wet = mega.canMega(b.match, b.me);

    const before = { hp: u.maxHP, card: u.card.id };
    mega.mega(b.match, b.me);
    await new Promise((r) => setTimeout(r, 900));

    return {
      dry, wet, before,
      after: { hp: u.maxHP, card: u.card.id, mega: u.mega },
      hasView: b.views.has(u.id),
    };
  });

  expect(out.dry).toBe(false);            // grey without elixir
  expect(out.wet).toBe(true);             // lit with it
  expect(out.after.card).toBe("megacharizard");
  expect(out.after.mega).toBe(true);
  expect(out.after.hp).toBeGreaterThan(out.before.hp);
  expect(out.hasView).toBe(true);         // the swapped sprite exists
  expect(errors, errors[0] ?? "").toEqual([]);
});
