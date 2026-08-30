/**
 * The twenty faces a creature can wear.
 *
 * Separate from `portraits.ts` on purpose. That module serves one shared sheet
 * holding every creature's default face, which is right for a roster grid where
 * 341 portraits are on screen at once. Emotions are the opposite shape: you
 * look at ONE creature's twenty faces, and only when you open it. So they live
 * in per-creature sheets under `tiles/emotions/`, fetched on demand -- opening
 * Charmander costs 59 KB, not the 19.7 MB the whole set weighs.
 *
 * A sheet holds that creature's normal emotions first, then its shiny ones, in
 * the canonical order below. The manifest records which of the twenty each
 * creature actually has, because coverage is uneven upstream.
 */

import data from "../data/emotions.json";

interface Manifest {
  size: number;
  cols: number;
  emotions: string[];
  /** `n` and `s` hold indices into `emotions`, in sheet order. */
  creatures: Record<string, { n: number[]; s: number[] }>;
}

const DATA = data as Manifest;

/** Canonical order, which is also the price ladder: 50 / 100 / 150 / 200. */
export const EMOTIONS: readonly string[] = DATA.emotions;

/** The emotion every creature has, and the one a card wears unless told otherwise. */
export const NORMAL = 0;

export function nameOf(emotion: number): string {
  return DATA.emotions[emotion] ?? DATA.emotions[NORMAL];
}

/** Which emotions this creature has art for. Empty when it has no sheet at all. */
export function available(species: string, shiny = false): readonly number[] {
  const c = DATA.creatures[species];
  if (!c) return [];
  return shiny ? c.s : c.n;
}

export function has(species: string, emotion: number, shiny = false): boolean {
  return available(species, shiny).includes(emotion);
}

/**
 * Where an emotion sits in its creature's sheet.
 *
 * Shiny frames follow all the normal ones, so a shiny's row depends on how many
 * normal emotions that creature happens to have -- which varies. Computing it
 * from the manifest rather than assuming twenty is what keeps the uneven
 * coverage from silently shifting every shiny by a few frames.
 */
function frameOf(species: string, emotion: number, shiny: boolean): number | undefined {
  const c = DATA.creatures[species];
  if (!c) return undefined;
  const list = shiny ? c.s : c.n;
  const at = list.indexOf(emotion);
  if (at < 0) return undefined;
  return shiny ? c.n.length + at : at;
}

export interface EmotionStyle {
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  width?: string;
  height?: string;
}

/**
 * A DOM style for one emotion. Returns `{}` when that face does not exist, so a
 * caller can fall back to the shared portrait sheet rather than render a hole.
 */
export function styleFor(
  species: string,
  emotion: number,
  shiny: boolean,
  sizePx: number,
): EmotionStyle {
  const frame = frameOf(species, emotion, shiny);
  if (frame === undefined) return {};
  const c = DATA.creatures[species];
  const total = c.n.length + c.s.length;
  const rows = Math.ceil(total / DATA.cols);
  const k = sizePx / DATA.size;
  return {
    backgroundImage: `url(/tiles/emotions/${species}.png)`,
    backgroundSize: `${DATA.cols * DATA.size * k}px ${rows * DATA.size * k}px`,
    backgroundPosition: `${-(frame % DATA.cols) * sizePx}px ${-Math.floor(frame / DATA.cols) * sizePx}px`,
    width: `${sizePx}px`,
    height: `${sizePx}px`,
  };
}
