/**
 * Pictures of the game, taken from the game.
 *
 * The landing page needs a screenshot and a link preview needs a 1200x630
 * card, and this repo had neither -- not one image of the thing it is. Taken
 * rather than drawn, so they cannot show a version that never shipped.
 *
 *   node tools/shoot.mjs [baseUrl]
 *
 * Defaults to the dev server. Writes into client/public/, which Cloudflare
 * Pages copies verbatim.
 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, "../client");
const OUT = resolve(CLIENT, "public");

// Playwright is the client's dependency, not this directory's: `tools/` has no
// package of its own beyond the dex generator's. Resolved from there rather
// than installed twice.
const { chromium } = createRequire(resolve(CLIENT, "package.json"))("playwright");

const BASE = process.argv[2] ?? "http://localhost:5173";
/** The design surface, at twice the pixels so it survives a retina screen. */
const WIDE = 620, TALL = 1080, SCALE = 2;

/**
 * Deep enough in for a real push.
 *
 * At 14s the board was two empty lanes and one creature: honest, and a poor
 * advertisement for a game about fights. Elixir fills at 0.4/s, so by ~50s
 * both sides have spent a bar and the bridges have traffic on them.
 */
const INTO_THE_MATCH = 52_000;

const booted = (name) => `
  (() => {
    const s = window.lr?.scene.getScene(${JSON.stringify(name)});
    return s?.sys.settings.status === 5;
  })()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: WIDE, height: TALL },
    deviceScaleFactor: SCALE,
  });

  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));

  await page.goto(`${BASE}/play.html`, { waitUntil: "load" });
  await page.waitForFunction(booted("Menu"), undefined, { timeout: 90_000 });

  // Straight into a match against the bot: the menu is not the picture, the
  // board is. `seat: 1` is what the e2e suite uses.
  await page.evaluate(() => window.lr.scene.getScene("Menu").scene.start("Battle", { seat: 1 }));
  await page.waitForFunction(booted("Battle"), undefined, { timeout: 90_000 });
  await page.waitForTimeout(INTO_THE_MATCH);

  await page.screenshot({ path: resolve(OUT, "shot-match.png") });
  console.log(`shot-match.png  ${WIDE * SCALE}x${TALL * SCALE}`);

  await browser.close();
  if (problems.length) {
    console.error("page errors while shooting:\n  " + problems.join("\n  "));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
