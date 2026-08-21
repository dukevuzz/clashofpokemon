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
      // Draw at the screen's real pixels. Without this the canvas is
      // 620x1080 everywhere and a phone stretches it 2.3x to fit, on top of
      // the scale the GPU already applied.
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

/** Smooth when the canvas is shrunk to fit, sharp when it is enlarged. */
function matchCanvasToScreen(game: Phaser.Game) {
  const c = game.canvas;
  if (!c) return;
  const shown = c.getBoundingClientRect().height * (window.devicePixelRatio || 1);
  const factor = shown / DESIGN_H;
  c.style.imageRendering = factor > 1.05 ? "pixelated" : "auto";
}
