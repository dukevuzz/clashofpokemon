import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Stamped into the bundle so a bug report says which build it came from.
  // Without it every report is about "the site", and the first question --
  // "is this still happening?" -- has no answer.
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? "dev") },
  base: "./",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    // Two pages, not one. The guide is a document and shares only the palette
    // and the card data with the game, so it has no reason to pull Phaser in
    // -- and a player reading it is very often on the connection that made
    // them look something up rather than play.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        guide: fileURLToPath(new URL("./guide.html", import.meta.url)),
      },
    },
  },
  server: { port: 5173, open: false },
  test: {
    // `tests/e2e` is Playwright's. Vitest would load it, find no browser and
    // fail in a way that says nothing about the game -- and the two runners
    // answer different questions: vitest the rules, Playwright the screens.
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
