import { publishPalette } from "./ui/theme";
/** Entry point and the whole of the resolution problem. */

import Phaser from "phaser";
import * as sprites from "./ui/sprites";
import { DESIGN_W, DESIGN_H } from "./ui/layout";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { BattleScene } from "./scenes/BattleScene";
import { DeckScene } from "./scenes/DeckScene";
import { DexScene } from "./scenes/DexScene";

/** The sprite frame tables, fetched before the game exists. */
const indexReady = fetch("atlas/index.json")
  .then((r) => r.json())
  .then((data) => sprites.setIndex(data))
  .catch(() => {
    // A missing index means no creature can be drawn, which is worth saying out
    // loud rather than presenting as an empty board.
    document.body.textContent = "Could not load sprite data.";
  });

function boot(): Phaser.Game {
  // One copy of the palette: the canvas reads `C`, the DOM reads the same
  // values as CSS variables.
  publishPalette();

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0b0b0e",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_W,
      height: DESIGN_H,
      // Draw at the screen's real pixels, not at 620x1080 for everyone.
      //
      // The board must fit on any device, so framing cannot change -- which
      // leaves resolution. Without this the canvas is 620x1080 wherever it
      // runs, and a phone with 2532 physical pixels of height inflates it by
      // 2.34x in the browser, on top of the 1.35x the GPU already applied.
      // Two resamples of a 25px creature. Zoom raises the backing store so
      // there is one.
      zoom: Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1))),
    },
    // Sprites are pixel art from a 24px tile set; smoothing them turns a crisp
    // creature into a smear at the 1.7x the arena is drawn at.
    pixelArt: true,
    roundPixels: true,
    scene: [BootScene, MenuScene, DeckScene, BattleScene, DexScene],
  });
}

// The game is constructed only once the tables are in hand, because the first
// scene boots itself and its preload needs them.
indexReady.then(() => {
  const game = boot();
  // A handle on the running game, for inspecting state from the console. Kept
  // in the shipped build deliberately: this is a hobby project and being able
  // to ask the live scene what it thinks is happening has already been worth
  // more than the two lines cost.
  (window as unknown as { lr: Phaser.Game }).lr = game;
  game.events.once(Phaser.Core.Events.READY, () => {
    matchCanvasToScreen(game);
    window.addEventListener("resize", () => matchCanvasToScreen(game));
  });
});

/**
 * How the browser should stretch the finished canvas onto the screen.
 *
 * The canvas is always 620x1080 and the browser fits it to the window, so the
 * final step is a scale nobody chose. On a 1080p desktop that lands at 0.83 --
 * shrinking, where smoothing is right. On a phone it is 2.3x, because the
 * canvas is measured in CSS pixels and the screen has three physical ones for
 * each; smoothing a 2.3x enlargement is what makes the same creature look
 * softer on mobile than on a laptop.
 *
 * So it follows the direction of the scale rather than being fixed: smooth on
 * the way down, sharp on the way up.
 */
function matchCanvasToScreen(game: Phaser.Game) {
  const c = game.canvas;
  if (!c) return;
  const shown = c.getBoundingClientRect().height * (window.devicePixelRatio || 1);
  const factor = shown / DESIGN_H;
  c.style.imageRendering = factor > 1.05 ? "pixelated" : "auto";
}
