/**
 * The page a search result lands on.
 *
 * `tests/site.test.ts` reads the HTML as a file and checks it says the right
 * things. This checks the different question a file cannot answer: that the
 * page renders without the game's bundle, that its links go where they claim,
 * and that the game is still there on the other side of them.
 */

import { test, expect } from "@playwright/test";

test("says what the game is, without running any of it", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Clash of Pokémon");
  // Phaser is 1.5 MB and has no business here.
  expect(scripts, `landing page fetched scripts: ${scripts.join(", ")}`).toHaveLength(0);
});

test("the fan-project notice is on the page, not only in a meta tag", async ({ page }) => {
  await page.goto("/");
  const body = await page.locator("body").innerText();
  expect(body).toContain("Nintendo");
  expect(body).toMatch(/not affiliated/i);
  expect(body).toMatch(/no advertisements|nothing here is sold/i);
});

test("leads to the game", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /play in your browser/i }).click();
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5,
    undefined, { timeout: 60_000 });
  expect(page.url()).toContain("play");
});

test("leads to the guide", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /field guide/i }).click();
  await expect(page.locator("#guide")).toBeVisible();
});

test("reads on a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
});
