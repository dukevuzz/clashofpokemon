/**
 * The guide, in a browser.
 *
 * Two things are worth testing here and one of them is not "does it render".
 *
 * The first is the filters, because their whole reason for existing is that
 * they intersect -- and a bug where the last facet quietly replaces the others
 * looks completely normal on screen. So: apply two from different groups and
 * check what survives satisfies both.
 *
 * The second is that the page's figures are the game's figures. It reads them
 * from `config.ts` through `facts.ts` so a retune cannot leave the guide lying,
 * and asserting a hardcoded "546" here would defeat that by pinning the number
 * in a second place. So the expectations are read out of the page's own data at
 * runtime and compared against what it rendered -- which catches the thing that
 * would actually go wrong later: somebody typing a literal into the prose.
 */

import { test, expect, type Page } from "@playwright/test";

/** The config-derived data the page was built from. */
const data = (page: Page) =>
  page.evaluate(() => (window as any).guide as {
    facts: any;
    cards: Array<{ id: string; name: string; elixir: number; damage: number; rarity: string; types: string[] }>;
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/guide.html");
  await expect(page.getByRole("heading", { name: "How a match works" })).toBeVisible();
});

test("the guide quotes the game's own numbers", async ({ page }) => {
  const { facts } = await data(page);

  // Scoped: the Roles section grew a table too, and an unscoped
  // ".g-table" would silently start asserting against that one.
  const towers = page.locator("#towers .g-table");
  await expect(towers).toContainText(String(facts.towers.side.hp));
  await expect(towers).toContainText(String(facts.towers.king.hp));
  await expect(towers).toContainText(String(facts.towers.king.damage));

  await expect(page.locator("#basics")).toContainText(facts.match.length);
  await expect(page.locator("#basics")).toContainText(String(facts.roster.total));
  await expect(page.locator("#elixir")).toContainText(String(facts.elixir.max));
  await expect(page.locator("#towers")).toContainText(String(facts.towers.king.wakeSeconds));
});

test("every Pokemon in the game is listed", async ({ page }) => {
  const { cards } = await data(page);
  await expect(page.locator(".g-card")).toHaveCount(cards.length);
});

test("filters narrow together rather than replacing each other", async ({ page }) => {
  const { cards } = await data(page);
  const grid = page.locator(".g-card");

  await page.getByRole("button", { name: "legendary", exact: true }).click();
  const legendary = await grid.count();
  expect(legendary).toBeGreaterThan(0);
  expect(legendary).toBeLessThan(cards.length);

  // A second facet from a different group. If facets replaced one another this
  // count would jump to the number of Flying types instead of falling.
  // Scoped to the browser -- the type chart has a FLY button too.
  await page.locator("#pokemon").getByRole("button", { name: "FLY", exact: true }).click();
  const both = await grid.count();
  expect(both).toBeLessThanOrEqual(legendary);
  expect(both).toBe(
    cards.filter((c) => c.rarity === "legendary" && c.types.includes("FLYING")).length);
});

test("a filter set can be read out of the URL and back", async ({ page }) => {
  await page.getByRole("button", { name: "epic", exact: true }).click();
  await page.getByRole("searchbox").fill("cha");
  await expect(page).toHaveURL(/q=cha/);

  const before = await page.locator(".g-card").count();
  await page.reload();
  await expect(page.locator(".g-card")).toHaveCount(before);
  await expect(page.getByRole("searchbox")).toHaveValue("cha");
});

test("an impossible filter set says so instead of showing an empty grid", async ({ page }) => {
  await page.getByRole("searchbox").fill("zzzzzz");
  await expect(page.locator(".g-empty")).toBeVisible();
  await expect(page.locator(".g-result")).toContainText("0");
});

test("clear all restores the whole roster", async ({ page }) => {
  const { cards } = await data(page);
  await page.getByRole("button", { name: "rare", exact: true }).click();
  await page.getByRole("button", { name: "clear all" }).click();
  await expect(page.locator(".g-card")).toHaveCount(cards.length);
});

test("a card opens a detail sheet with its real stats", async ({ page }) => {
  const { cards } = await data(page);
  const pick = cards.find((c) => c.id === "pikachu") ?? cards[0];

  await page.getByRole("searchbox").fill(pick.name);
  await page.locator(".g-card").first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText(pick.name);
  await expect(sheet).toContainText(`${pick.elixir} elixir`);
  await expect(sheet).toContainText(String(pick.damage));

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("the roles table is measured, not written down", async ({ page }) => {
  // The blurbs were wrong five times out of seven when they were prose only.
  // The table beside them comes from the roster, so it cannot drift; this
  // checks the two are actually rendered together.
  const rows = page.locator("#roles tbody tr");
  await expect(rows).toHaveCount(7);
  await expect(page.locator("#roles")).toContainText("Nothing outranges a tower");
});

test("an evolution in the chain opens that card", async ({ page }) => {
  // The chain is exactly where a player asks "what does that one do", and it
  // was a row of pictures that did nothing when pressed.
  await page.getByRole("searchbox").fill("Charmander");
  await page.locator(".g-card").first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Charmander");

  await sheet.getByRole("button", { name: /See Charmeleon/ }).click();
  await expect(sheet).toContainText("Charmeleon");
  // And onward, so a whole line can be walked without going back to the grid.
  await sheet.getByRole("button", { name: /See Charizard/ }).click();
  await expect(sheet).toContainText("Charizard");
});

test("the step you are looking at is not a link to itself", async ({ page }) => {
  await page.getByRole("searchbox").fill("Charmander");
  await page.locator(".g-card").first().click();
  const here = page.getByRole("dialog").getByRole("button", { name: /you are here/ });
  await expect(here).toBeDisabled();
});

test("Deoxys' bodies open the same way", async ({ page }) => {
  await page.getByRole("searchbox").fill("Deoxys");
  await page.locator(".g-card").first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /See Deoxys.*Attack|See Attack/i }).first().click();
  await expect(sheet).toContainText(/attack/i);
});

test("choosing the last section marks it, even though it cannot reach the top",
  async ({ page }) => {
  /*
   * Reported from the page: pressed "Bugs & ideas" and the nav went on lighting
   * "Every Pokémon".
   *
   * The cause is a layout fact rather than a scrolling one. That section begins
   * about 400px *below* the furthest the page can scroll, so its top never
   * crosses the top of the screen and no "has this heading gone past?" rule can
   * ever choose it. The old rule -- most-visible-section-wins -- had the same
   * blind spot from the other direction: the section is short, so a tall one
   * above it wins forever.
   *
   * The waits matter. An earlier version of this test measured 1.2s after the
   * click, caught the smooth scroll still moving, and "failed" against the
   * fixed code while passing against the broken code. It has to settle first.
   */
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/guide.html");
  await page.waitForSelector(".g-card");

  await page.getByRole("link", { name: "Bugs & ideas" }).click();
  await page.waitForFunction(() => {
    const max = document.body.scrollHeight - window.innerHeight;
    return Math.abs(window.scrollY - max) < 2;
  }, undefined, { timeout: 15_000 });
  await page.waitForTimeout(300);

  const nav = page.locator(".g-nav");
  await expect(nav.getByRole("link", { name: "Bugs & ideas" }))
    .toHaveAttribute("aria-current", "true");
  await expect(nav.getByRole("link", { name: "Every Pokémon" }))
    .not.toHaveAttribute("aria-current", "true");
});

test("and it still tracks normally further up the page", async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".g-nav").getByRole("link", { name: "How a match works" }))
    .toHaveAttribute("aria-current", "true");
});

test("a link into a section lands on that section", async ({ page }) => {
  /*
   * Caught on production, not here: the menu's "report a bug" link opened the
   * guide at the very top.
   *
   * The filter sync ran on mount, found nothing filtered, and rewrote the URL
   * to the bare path -- erasing the fragment before the browser could scroll
   * to it. Every deep link into the page was broken the same way, including
   * any that had been shared.
   */
  await page.goto("/guide.html#feedback");
  await page.waitForSelector(".g-form");
  await page.waitForTimeout(500);

  expect(page.url()).toContain("#feedback");

  // getBoundingClientRect, not Playwright's boundingBox: the latter is not
  // viewport-relative here and reported the section 1,594px "below" a screen
  // it was actually sitting at the top of.
  const top = await page.evaluate(
    () => document.getElementById("feedback")!.getBoundingClientRect().top);
  expect(top).toBeLessThan(200);
  expect(top).toBeGreaterThan(0);
});

test("filters still reach the URL once something is chosen", async ({ page }) => {
  await page.goto("/guide.html");
  await page.waitForSelector(".g-card");
  await page.getByRole("button", { name: "epic", exact: true }).click();
  await expect(page).toHaveURL(/rarity=epic/);
});

test("the type chart answers one type at a time", async ({ page }) => {
  await page.locator("#types .g-chart-pick button").nth(1).click();
  await expect(page.locator(".g-eff-good")).toBeVisible();
  await expect(page.locator(".g-eff-bad")).toBeVisible();
});

test("the guide is reachable from the menu and leads back", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "GUIDE" });
  await expect(link).toBeVisible();
  // Opens a new tab deliberately, so a match in progress survives being curious.
  await expect(link).toHaveAttribute("target", "_blank");

  await page.goto("/guide.html");
  await page.getByRole("link", { name: /Back to the game/ }).first().click();
  await expect(page).toHaveURL(/index\.html|\/$/);
});

/**
 * The attribution is on the page, not only in a file nobody opens.
 *
 * This is a fan project built on somebody else's characters, so the copyright
 * notice belongs where a player and a rights holder both see it without
 * looking: the first screen of the game, and the foot of the guide. Naming the
 * three companies and the trademark line is the standard attribution, and
 * saying no money changes hands is the part that matters most.
 */
test("the menu carries the copyright notice", async ({ page }) => {
  await page.goto("/");
  const legal = page.locator(".lr-legal");
  await expect(legal.first()).toBeVisible();
  const text = (await legal.allTextContents()).join(" ");

  expect(text).toContain("Nintendo");
  expect(text).toContain("Creatures Inc.");
  expect(text).toContain("GAME FREAK");
  expect(text).toMatch(/©/);
  expect(text).toMatch(/non-commercial/i);
  expect(text).toMatch(/not affiliated/i);
});

test("the guide carries the copyright notice too", async ({ page }) => {
  await page.goto("/guide.html");
  const foot = page.locator(".g-foot");
  await foot.scrollIntoViewIfNeeded();
  const text = await foot.textContent() ?? "";

  expect(text).toContain("Nintendo");
  expect(text).toContain("Creatures Inc.");
  expect(text).toContain("GAME FREAK");
  expect(text).toMatch(/©/);
  expect(text).toMatch(/no money is made/i);
});

test("the copyright is in the page source, not only the rendering", async ({ page }) => {
  // Where somebody checking the site — rather than playing it — would look.
  for (const url of ["/", "/guide.html"]) {
    await page.goto(url);
    const meta = await page.locator('meta[name="copyright"]').getAttribute("content");
    expect(meta, `${url} declares it`).toContain("Nintendo");
    expect(meta).toContain("GAME FREAK");
  }
});

/**
 * Choosing two types means both, not either.
 *
 * It meant "either", on the reasoning that nobody asks for "Fire and Water".
 * Ninety-four of a hundred and twenty-seven Pokémon here carry more than one
 * type, so the combination is the ordinary case -- and somebody who taps a
 * second type is narrowing, which is what every other facet does. Reported as
 * "if i chose 2 type mean i want it has both".
 */
test("two types means both of them", async ({ page }) => {
  await page.goto("/guide.html#pokemon");

  const count = async () => (await page.locator(".g-card").count());
  // Scoped to the browser: the type chart further down the page has buttons
  // with the very same three-letter labels.
  const pick = async (label: string) =>
    page.locator("#pokemon").getByRole("button", { name: label, exact: true }).click();

  await pick("FIR");
  const fireOnly = await count();
  expect(fireOnly).toBeGreaterThan(0);

  await pick("FLY");
  const namesNow = async () =>
    (await page.locator(".g-card .g-name").allTextContents()).map((t) => t.trim());
  const both = await count();
  const names = await namesNow();

  // Narrower, not wider: the whole point of the fix.
  expect(both).toBeLessThan(fireOnly);
  expect(both).toBeGreaterThan(0);

  // And what is left is exactly the overlap of the two single-type lists.
  // Checked as set algebra through the page itself: "both" is by definition
  // the intersection, and "either" would be the union.
  const shown = new Set(names);
  await pick("FIR");                                   // Flying alone
  const flyOnly = new Set(await namesNow());
  await pick("FLY");
  await pick("FIR");                                   // Fire alone again
  const fireSet = new Set(await namesNow());

  const intersection = [...fireSet].filter((n) => flyOnly.has(n)).sort();
  expect([...shown].sort()).toEqual(intersection);
  expect(intersection.length).toBeLessThan(fireSet.size);
});

/**
 * How many types, which the type pills cannot ask.
 *
 * A triple type takes extra damage from more things than a single does, so
 * "show me the pure ones" is a real question — and there are ten triples in a
 * hundred and twenty-seven, which is not a list anybody finds by scrolling.
 */
test("the number of types is its own filter", async ({ page }) => {
  await page.goto("/guide.html#pokemon");
  const count = async () => (await page.locator(".g-card").count());
  const all = await count();

  await page.locator("#pokemon")
    .getByRole("button", { name: "triple", exact: true }).click();
  const triples = await count();
  expect(triples).toBeGreaterThan(0);
  expect(triples).toBeLessThan(all);

  // It survives a reload, like every other filter.
  expect(page.url()).toContain("types=3");
  await page.reload();
  expect(await count()).toBe(triples);

  // Single and triple together is "either", the way rarity behaves.
  await page.locator("#pokemon")
    .getByRole("button", { name: "single", exact: true }).click();
  expect(await count()).toBeGreaterThan(triples);
});

/**
 * A card says what beats it.
 *
 * Asked for as "x4 or x2 on pokemon we select, like Lugia has a section of
 * weakness". Lugia is Water/Flying/Psychic, which without this is three
 * lookups in the type chart and an intersection done by hand before you learn
 * the answer is Electric — and that a 2-elixir Chinchou answers a 7-elixir
 * legendary.
 */
test("a card lists what beats it, hardest first", async ({ page }) => {
  await page.goto("/guide.html#pokemon");
  await page.locator("#pokemon input").first().fill("Lugia");
  await page.locator(".g-card").first().click();

  const weak = page.locator(".g-match", { hasText: "Weak to" });
  await expect(weak).toBeVisible();

  const rows = await weak.locator(".g-match-row").allTextContents();
  expect(rows.length).toBeGreaterThan(0);

  // The worst multiplier leads, because it is the answer being looked for.
  expect(rows[0]).toContain("×4");
  const mults = rows.map((r) => Number(r.match(/×([\d.]+)/)?.[1] ?? 0));
  expect(mults).toEqual([...mults].sort((a, b) => b - a));

  // And Electric is what does it — checked by name so a renamed type fails.
  expect(rows[0]).toContain("ELC");
});

test("the counter it names is one you can actually play", async ({ page }) => {
  await page.goto("/guide.html#pokemon");
  await page.locator("#pokemon input").first().fill("Lugia");
  await page.locator(".g-card").first().click();

  const first = page.locator(".g-match", { hasText: "Weak to" }).locator(".g-match-row").first();
  const name = (await first.textContent() ?? "").replace(/×[\d.]+|[A-Z]{3}/g, "").trim();
  expect(name.length).toBeGreaterThan(0);

  // Clicking it opens that card, which is the point of listing an example.
  await first.click();
  await expect(page.locator("h3").first()).toContainText(name);
});

/**
 * The lane animation exists and is drawing something.
 *
 * The timeline is tested properly in `showcase.test.ts`; this only checks the
 * canvas is mounted and has been painted, because a silent failure here is a
 * blank green rectangle that looks deliberate.
 */
test("a card shows itself walking up a lane", async ({ page }) => {
  await page.goto("/guide.html#pokemon");
  await page.locator("#pokemon input").first().fill("Machop");
  await page.locator(".g-card").first().click();

  const canvas = page.locator(".g-showcase-canvas");
  await expect(canvas).toBeVisible();

  /*
   * Painted, and moving.
   *
   * Compared as content rather than as length: two different frames can encode
   * to the same number of bytes, which a first version of this took as proof
   * the animation had stopped.
   */
  const shot = async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const a = await shot();
  expect(a.length).toBeGreaterThan(1000);

  let moved = false;
  for (let i = 0; i < 10 && !moved; i++) {
    await page.waitForTimeout(180);
    moved = (await shot()) !== a;
  }
  expect(moved, "the canvas is animating").toBe(true);
});
