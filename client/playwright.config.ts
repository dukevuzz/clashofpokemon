/**
 * End-to-end, against the build that actually ships.
 *
 * Everything the deck builder does to *data* is covered headlessly by vitest --
 * `deckEdit` and `deckStore` are plain functions and are tested as such. What
 * that cannot reach is the part where a real click lands on a real pixel and a
 * Phaser scene starts: navigation, scene lifecycle, and whether a choice made
 * on one screen survives a trip to another.
 *
 * That gap is exactly where this project's bugs keep living, and it was being
 * checked by hand, badly. `webServer` builds and previews, so a run tests the
 * shipped bundle rather than a dev server with different loading behaviour --
 * which matters here, since the last serious bug was a loader stalling on file
 * count.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 4310; // not 4300, so a run never fights a preview left open

/**
 * Point the suite at something already running instead of building one.
 *
 *     E2E_BASE_URL=https://lane-royale.pages.dev npx playwright test
 *
 * For smoke-testing a deployment. The local default builds from source, which
 * answers "does this code work"; this answers the different and equally
 * important question "is what I just uploaded the thing that works" -- a build
 * can be green and the upload still be stale, partial, or served from the wrong
 * directory, and none of that is visible from here without asking the real URL.
 */
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  // Phaser boots, fetches a 1.5 MB atlas index and creates scenes; generous but
  // not unbounded, because "never finishes" is a failure worth catching.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false, // one game, one localStorage, one port
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Nothing to start when the target is already up somewhere.
  webServer: REMOTE ? undefined : {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
