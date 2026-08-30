import { test, expect } from "@playwright/test";

/**
 * The game still works when the backend does not.
 *
 * Single player has no business needing a network. It is most of what this
 * game is, it worked for months before any server existed, and a player on a
 * train should not be told to come back later.
 *
 * So the online button is offered only when *both* tiers answer -- a game
 * server to play on and a meta tier to prove who you are. Showing it when one
 * of them is down is offering a button that fails halfway through, which is
 * worse than not offering it.
 *
 * Skips itself when the API is up, rather than failing: this asserts what
 * happens in its absence, and a suite that has to be run in a particular order
 * to be green is a suite people stop running.
 */
const API = process.env.API_URL ?? "http://localhost:4500";

async function apiUp(): Promise<boolean> {
  try {
    return (await fetch(`${API}/v1/content`)).ok;
  } catch {
    return false;
  }
}

test("with the meta tier down, single player is unaffected", async ({ page }) => {
  test.skip(await apiUp(), "the API is running -- stop it to exercise this");
  await page.goto("/");
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  // The reachability probe has its own budget; give it room to have failed.
  await page.waitForTimeout(4000);

  // Offered: the game. One BATTLE button now, with a drawer choosing what it
  // means, so what to assert changed shape -- the button is always there and
  // it is the MODE that is or is not available.
  await expect(page.getByRole("button", { name: /BATTLE/ })).toBeVisible();

  // Not offered: the half of it that cannot work. Open the drawer and the
  // online mode is present but disabled, which is a better guarantee than it
  // being absent -- a missing button could mean the menu failed to render.
  await page.getByRole("button", { name: "choose a mode" }).click();
  await expect(page.getByRole("button", { name: /^ONLINE/ })).toBeDisabled();

  // And it actually plays.
  await page.evaluate(() =>
    (window as any).lr.scene.getScene("Menu").scene.start("Battle"));
  await page.waitForFunction(() => {
    const b = (window as any).lr?.scene.getScene("Battle");
    return b?.sys.settings.status === 5;
  }, undefined, { timeout: 60_000 });

  const running = await page.evaluate(async () => {
    const b = (window as any).lr.scene.getScene("Battle");
    const before = b.match.time;
    await new Promise((r) => setTimeout(r, 2000));
    return { moved: before - b.match.time, net: Boolean(b.net) };
  });
  expect(running.net).toBe(false);          // genuinely local
  expect(running.moved).toBeGreaterThan(1.5); // and genuinely running
});
