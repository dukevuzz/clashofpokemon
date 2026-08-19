/** Sprite sheet descriptors, as plain data. */

import sheetsJson from "./sheets.json";

export interface SheetAnim {
  row: number;
  frames: number;
  durations: number[];
}

export interface Sheet {
  name: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  bodyWidth: number;
  bodyHeight: number;
  feetOffset: number;
  /** Which animation row is this creature's attack, resolved once by `tools/resolve-poses.py` rather than guessed at draw time. */
  attack: string | null;
  shoot: string | null;
  /** The pose for casting a skill, which PAC records separately from the attack. */
  ability: string | null;
  anims: Record<string, Record<string, SheetAnim>>;
}

export const SHEETS = sheetsJson as unknown as Record<string, Sheet>;

export const hasSheet = (name: string): boolean => name in SHEETS;
