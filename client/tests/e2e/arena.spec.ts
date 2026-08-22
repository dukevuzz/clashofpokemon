import { test, expect } from "@playwright/test";

/*
 * The arena a match is played on is picked per match, and two things have to
 * hold: it varies, and both players get the same one. The second is why the
 * pick is hashed from the match id rather than drawn from `match.rng` -- the
 * simulation draws from that stream, and taking a number out of it here would
 * shift every draw after it until the two engines disagreed.
 */
async function battle(page: any, opts: Record<string, unknown> = {}) {
  await page.evaluate((o: any) => {
    const lr = (window as any).lr;
    lr.scene.getScene("Battle")?.scene.stop();
    lr.scene.getScene("Menu").scene.start("Battle", { seat: 1, ...o });
  }, opts);
  await page.waitForTimeout(700);
  // Read it off the scene, not off a second copy of the module.
  return page.evaluate(() => (window as any).lr.scene.getScene("Battle").arenaTheme);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
});

test("offline matches are dealt varied arenas", async ({ page }) => {
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) seen.push(await battle(page));
  expect(new Set(seen).size).toBeGreaterThan(1);
});

test("a forced arena overrides the roll", async ({ page }) => {
  await page.goto("/?theme=magma");
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  expect(await battle(page)).toBe("magma");
});
