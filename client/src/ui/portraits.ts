/** The face of a creature, as opposed to a frame of it walking. */

import type Phaser from "phaser";
import portraitsJson from "../data/portraits.json";

const DATA = portraitsJson as {
  size: number;
  cols: number;
  frames: Record<string, number>;
};

export function preload(load: Phaser.Loader.LoaderPlugin) {
  load.spritesheet("portraits", "tiles/portraits.png",
                   { frameWidth: DATA.size, frameHeight: DATA.size });
}

/** Does this species have a portrait? Not every sheet in the game does. */
export function has(species: string): boolean {
  return DATA.frames[species] !== undefined;
}

/** The same portrait, for a DOM element. */
export interface PortraitStyle {
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  width?: string;
  height?: string;
}

export function styleFor(species: string, sizePx: number): PortraitStyle {
  const frame = DATA.frames[species];
  if (frame === undefined) return {};
  const col = frame % DATA.cols;
  const row = Math.floor(frame / DATA.cols);
  const rows = Math.ceil(Object.keys(DATA.frames).length / DATA.cols);
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
