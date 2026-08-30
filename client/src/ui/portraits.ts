/** The face of a creature, as opposed to a frame of it walking. */

import type Phaser from "phaser";
import portraitsJson from "../data/portraits.json";

const DATA = portraitsJson as {
  size: number;
  cols: number;
  frames: Record<string, number>;
  /**
   * Shiny frames, keyed the same way as `frames`. Appended below the normal
   * frames on the same sheet -- same columns, taller image -- once the
   * export tool that builds this has run. Until then this key is simply
   * absent, and every shiny lookup here has to answer as if it always were:
   * this data lands after the code that reads it does.
   */
  shiny?: Record<string, number>;
};

// Phaser slices a spritesheet from its own pixel dimensions, not from this
// JSON, so a taller sheet (shiny frames appended below the normal ones)
// needs no change here -- the frame count Phaser derives grows with the
// image on disk automatically.
export function preload(load: Phaser.Loader.LoaderPlugin) {
  load.spritesheet("portraits", "tiles/portraits.png",
                   { frameWidth: DATA.size, frameHeight: DATA.size });
}

/** Does this species have a portrait? Not every sheet in the game does. */
export function has(species: string): boolean {
  return DATA.frames[species] !== undefined;
}

/** Does this species have a SHINY portrait? False for all of them until the export tool ships `shiny`. */
export function hasShiny(species: string): boolean {
  return DATA.shiny?.[species] !== undefined;
}

/**
 * How many rows the sheet actually has.
 *
 * Not `Object.keys(DATA.frames).length` -- that was fine when the sheet held
 * only normal portraits, but shiny frames are appended below them on the
 * same image, so the true height is normal-count-plus-shiny-count. Sizing
 * the background from `frames` alone once shiny frames exist would measure
 * every background-position in the game against a sheet shorter than the
 * one actually on disk, and everything would render off by some fraction of
 * a row.
 */
function totalRows(): number {
  const total = Object.keys(DATA.frames).length + Object.keys(DATA.shiny ?? {}).length;
  return Math.ceil(total / DATA.cols);
}

/** The same portrait, for a DOM element. */
export interface PortraitStyle {
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  width?: string;
  height?: string;
}

/**
 * `shiny` defaults to false and silently falls back to the normal frame
 * whenever shiny art is not there for this species -- which is every
 * species today, and will still be most of them once the export tool has
 * run. A call site can pass `shiny={card.shiny}` unconditionally and never
 * needs to know whether the art exists yet.
 */
export function styleFor(species: string, sizePx: number, shiny = false): PortraitStyle {
  const frame = shiny ? DATA.shiny?.[species] ?? DATA.frames[species] : DATA.frames[species];
  if (frame === undefined) return {};
  const col = frame % DATA.cols;
  const row = Math.floor(frame / DATA.cols);
  const rows = totalRows();
  const k = sizePx / DATA.size;
  return {
    backgroundImage: "url(/tiles/portraits.png)",
    backgroundSize: `${DATA.cols * DATA.size * k}px ${rows * DATA.size * k}px`,
    backgroundPosition: `-${col * DATA.size * k}px -${row * DATA.size * k}px`,
    width: `${sizePx}px`,
    height: `${sizePx}px`,
  };
}

/** Put a portrait into an existing image, scaled to fit a box. */
export function apply(
  img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
  species: string,
  boxW: number, boxH: number,
): boolean {
  const frame = DATA.frames[species];
  if (frame === undefined || !img.scene?.textures.exists("portraits")) return false;
  // stop() first: these images are Sprites elsewhere and may be mid-animation
  // from a previous card, which would keep overwriting the frame we just set.
  if ("anims" in img) (img as Phaser.GameObjects.Sprite).anims?.stop();
  img.setTexture("portraits", frame);
  // Integer scale where one fits, because the art is pixel art and a
  // fractional zoom is exactly what makes it look soft. Below 1:1 there is no
  // integer to pick, so fall through to the real ratio.
  const fit = Math.min(boxW / DATA.size, boxH / DATA.size);
  img.setScale(fit >= 1 ? Math.floor(fit) : fit);
  img.setVisible(true);
  return true;
}
