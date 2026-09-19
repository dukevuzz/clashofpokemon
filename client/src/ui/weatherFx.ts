/**
 * The sky, drawn: a wash over the board, specks falling through it, and a line
 * telling the player what it does.
 *
 * Purely a picture. The rule already lives in `core/weather.ts` and already
 * changes damage in both engines; nothing here feeds back into the match.
 * What each weather looks like is data in `weatherLook.ts`.
 *
 * Every texture is generated here rather than shipped. Pokemon Auto Chess has
 * rain and sand sprites, but states no licence for them, and they are 17x17 --
 * cheaper to draw than to argue about.
 */

import Phaser from "phaser";
import { config } from "../core/config";
import type { Weather } from "../core/weather";
import { ARENA_SCALE, ARENA_X, ARENA_Y, DESIGN_W } from "./layout";
import { C, style, px } from "./theme";
import { LOOK, caption, type Speck } from "./weatherLook";

/** Above the creatures, below the drop marker and every banner. */
const DEPTH_TINT = 20;
const DEPTH_SPECKS = 21;
const DEPTH_ANNOUNCE = 36;

const key = (s: Speck) => `wx:${s}`;

/**
 * Draw each speck once per game; scenes restart, textures do not need to.
 *
 * Sizes are in design pixels, and the design is drawn at about two thirds of
 * that on a phone -- a one-pixel streak lands at 0.67 of a screen pixel and
 * simply is not there. Nothing here is thinner than two.
 */
function makeTextures(scene: Phaser.Scene) {
  const draw = (s: Speck, w: number, h: number, paint: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key(s))) return;
    const g = scene.make.graphics({}, false);
    paint(g);
    g.generateTexture(key(s), w, h);
    g.destroy();
  };
  draw("streak", 3, 20, (g) => {
    g.fillStyle(0xffffff, 0.45); g.fillRect(0, 0, 3, 20);
    g.fillStyle(0xffffff, 1); g.fillRect(1, 2, 1, 16);
  });
  draw("flake", 6, 6, (g) => { g.fillStyle(0xffffff, 1); g.fillCircle(3, 3, 2.4); });
  draw("mote", 3, 3, (g) => { g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 3, 3); });
  draw("wisp", 22, 2, (g) => { g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 22, 2); });
  draw("puff", 20, 20, (g) => {
    for (let r = 10; r > 0; r--) { g.fillStyle(0xffffff, 0.07); g.fillCircle(10, 10, r); }
  });
}

/** Particles are motion; a player who has asked for less motion gets the tint alone. */
function prefersLessMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Put the weather on screen. Returns nothing to hold on to: every object it
 * makes belongs to the scene and goes when the scene does.
 */
export function showWeather(scene: Phaser.Scene, weather: Weather | null) {
  if (!weather) return;
  const look = LOOK[weather];
  const w = config.arenaWidth * ARENA_SCALE;
  const h = config.arenaHeight * ARENA_SCALE;

  scene.add.rectangle(ARENA_X, ARENA_Y, w, h, look.tint, look.alpha)
    .setOrigin(0, 0).setDepth(DEPTH_TINT);

  const p = look.particle;
  if (p && !prefersLessMotion()) {
    makeTextures(scene);
    // Spawned across the whole board rather than only its top edge, so the
    // first frame is already raining instead of waiting for rain to arrive.
    const specks = scene.add.particles(0, 0, key(p.kind), {
      x: { min: ARENA_X - 40, max: ARENA_X + w + 40 },
      y: { min: ARENA_Y - 20, max: ARENA_Y + h },
      speedX: { min: p.speedX[0], max: p.speedX[1] },
      speedY: { min: p.speedY[0], max: p.speedY[1] },
      lifespan: p.life,
      frequency: p.every,
      alpha: { start: p.alpha, end: 0 },
      scale: p.scale,
      tint: p.tint,
      // A falling streak is drawn along its path, not upright.
      rotate: p.kind === "streak"
        ? Phaser.Math.RadToDeg(Math.atan2(p.speedY[0], p.speedX[0])) - 90 : 0,
    }).setDepth(DEPTH_SPECKS);
    // Kept to the board, so weather never falls across the clock or the hand.
    const clip = scene.make.graphics({}, false);
    clip.fillStyle(0xffffff).fillRect(ARENA_X, ARENA_Y, w, h);
    specks.setMask(clip.createGeometryMask());
  }

  announce(scene, weather);
  chip(scene, weather);
}

/**
 * The line that says what the sky does, over the board for a moment.
 *
 * A rule that changes damage and is never stated is a rule the player blames
 * on luck. Shown once, at the start -- the weather never changes, so there is
 * nothing to say twice.
 */
function announce(scene: Phaser.Scene, weather: Weather) {
  const y = ARENA_Y + config.arenaHeight * ARENA_SCALE * 0.5;
  const w = config.arenaWidth * ARENA_SCALE;
  const [name, ...rest] = caption(weather).split(" · ");

  const bg = scene.add.rectangle(0, 0, w, 64, 0x000000, 0.55);
  const big = scene.add.text(0, -13, name, style(28, C.gold, "bold")).setOrigin(0.5);
  const sub = scene.add.text(0, 17, rest.join("   "), style(15, C.text)).setOrigin(0.5);
  const box = scene.add.container(DESIGN_W / 2, y, [bg, big, sub]).setDepth(DEPTH_ANNOUNCE);
  scene.tweens.add({
    targets: box, alpha: 0, delay: 2200, duration: 700,
    onComplete: () => box.destroy(true),
  });
}

/** What stays up for the rest of the match: the sky's name, beside the clock. */
function chip(scene: Phaser.Scene, weather: Weather) {
  const text = scene.add.text(0, 0, LOOK[weather].name.toUpperCase(), px(14, C.gold))
    .setOrigin(0.5);
  const width = Math.max(92, text.width + 24);
  const x = ARENA_X + width / 2;
  const box = scene.add.rectangle(x, 40, width, 32, C.panelDim, 0.9)
    .setStrokeStyle(2, LOOK[weather].tint);
  text.setPosition(x, 40);
  box.setDepth(40);
  text.setDepth(41);
}
