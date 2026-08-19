/** The effect atlas, as plain typed data. */

import atlasJson from "./attacks-atlas.json";
import abilityJson from "./abilityFx.json";
import attacksJson from "./attacks.json";

/** One packed frame: `[x, y, w, h, offsetX, offsetY, sourceW, sourceH]` Where it sits in the sheet, how far it was trimmed from its cell's top-left, and the size o. */
export type PackedFrame =
  [number, number, number, number, number, number, number, number];

export interface FxInfo {
  sheet: string;
  frames: number;
  w: number;
  h: number;
}

export const FRAMES = (atlasJson as unknown as {
  frames: Record<string, PackedFrame>;
}).frames;

/** Per-ability effects, keyed by the move that casts them. */
export const ABILITY_FX = abilityJson as unknown as Record<string, FxInfo>;

/** Generic per-element effects: element -> melee | range | hit. */
export const ATTACKS = attacksJson as unknown as
  Record<string, Record<string, FxInfo>>;

/** Every frame an effect refers to, whether or not the atlas has it. */
export function referencedFrames(): string[] {
  const out: string[] = [];
  const add = (info: FxInfo) => {
    for (let i = 0; i < info.frames; i++) out.push(`${info.sheet}/${i}`);
  };
  for (const info of Object.values(ABILITY_FX)) add(info);
  for (const kinds of Object.values(ATTACKS)) for (const i of Object.values(kinds)) add(i);
  return out;
}
