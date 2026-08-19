/** PMD sprite sheets, converted to Phaser animations. */

import Phaser from "phaser";

// Re-exported so scenes keep a single import for everything sprite-shaped,
// while headless tools can take the data straight from data/sheets.
export { SHEETS, hasSheet, type Sheet, type SheetAnim } from "../data/sheets";
import { SHEETS } from "../data/sheets";

// The lists themselves live in `data/actions.ts`, which knows nothing about
// Phaser, so the guide can pick the same animation without importing an
// engine. Re-exported here so scenes keep one sprite-shaped import.
export { MELEE, RANGED } from "../data/actions";
import { actionFor, attackAnim, castAnim } from "../data/actions";
export { actionFor };

/** Queue the named sheets, skipping any already in the texture cache. */
/** The frame tables for every sheet, in one file. */
type CompactAtlas = Record<string, { cell: [number, number]; f: Record<string, number[]> }>;
let index: CompactAtlas | undefined;

/** Hand over the frame tables, before the game starts. */
export function setIndex(data: unknown) {
  index = data as CompactAtlas;
}

/** Queue the images, and remember which need a frame table attaching. */
const pending = new Set<string>();

export function preload(load: Phaser.Loader.LoaderPlugin, names: Iterable<string>) {
  for (const name of new Set(names)) {
    if (!SHEETS[name]) continue;
    if (load.textureManager.exists(`pm-${name}`)) continue;
    if (!index?.[name]) continue;
    load.image(`pm-${name}`, `atlas/${name}.png`);
    pending.add(name);
  }
}

/** The managers, remembered so a lazy path can reach them. */
let ANIMS: Phaser.Animations.AnimationManager | undefined;
let TEX: Phaser.Textures.TextureManager | undefined;

export function init(
  anims: Phaser.Animations.AnimationManager,
  textures: Phaser.Textures.TextureManager,
) {
  ANIMS = anims;
  TEX = textures;
}

/** Give one sheet its frame table, the first time anything asks for it. */
const attached = new Set<string>();

function ensureFrames(name: string) {
  if (attached.has(name) || !TEX) return;
  const entry = index?.[name];
  const tex = TEX.exists(`pm-${name}`) ? TEX.get(`pm-${name}`) : undefined;
  if (!entry || !tex) return;
  attached.add(name);
  const [w, h] = entry.cell;
  for (const [key, a] of Object.entries(entry.f)) {
    if (tex.has(key)) continue;
    const frame = tex.add(key, 0, a[0], a[1], a[2], a[3]);
    // Trimmed frames must report the cell they were cut from, or every offset
    // measured against the full cell -- the rider's seat, the health bar, the
    // shadow -- lands in the wrong place.
    frame?.setTrim(w, h, a[4], a[5], a[2], a[3]);
  }
}

/** Is this sheet loaded and ready to draw? */
export function loaded(textures: Phaser.Textures.TextureManager, name: string): boolean {
  return textures.exists(`pm-${name}`);
}

/** Create one animation, the first time it is played. */
function ensureAnim(sheetName: string, action: string, dir: string): string | undefined {
  const key = animKey(sheetName, action, dir);
  if (!ANIMS || !TEX) return undefined;
  if (ANIMS.exists(key)) return key;

  const entry = SHEETS[sheetName]?.anims[action]?.[dir];
  if (!entry || !TEX.exists(`pm-${sheetName}`)) return undefined;
  ensureFrames(sheetName);

  const total = entry.durations.reduce((a, b) => a + b, 0);
  const frames = Array.from({ length: entry.frames }, (_, i) => ({
    key: `pm-${sheetName}`,
    frame: `${action}-${dir}-${i}`,
  }));
  const tex = TEX.get(`pm-${sheetName}`);
  if (!frames.every((f) => tex.has(f.frame))) return undefined;

  ANIMS.create({
    key,
    frames,
    frameRate: total > 0 ? entry.frames / total : 12,
    repeat: action === "Walk" || action === "Idle" ? -1 : 0,
  });
  return key;
}


/** The stored attack pose for a sheet, or undefined when it ships none. */
export function attackPose(sheetName: string, action: string): string | undefined {
  const sheet = SHEETS[sheetName];
  if (!sheet) return undefined;
  if (action !== "Attack" && action !== "Shoot") return action;
  return (action === "Shoot" ? sheet.shoot : sheet.attack) ?? undefined;
}

export const animKey = (sheet: string, action: string, dir: string | number) =>
  `${sheet}:${action}:${dir}`;

/** The animation to play for a unit, falling back until something exists. */
export function resolve(sheetName: string, action: string, dir: number): string | undefined {
  const sheet = SHEETS[sheetName];
  if (!sheet) return undefined;

  let name = action;
  if (action === "Cast") {
    // The cast pose, falling back to the attack -- which is what every creature
    // used for both before this existed. Shared with the guide so a skill is
    // shown there with the animation it actually plays.
    name = castAnim(sheetName);
  } else if (action === "Attack" || action === "Shoot") {
    // Read, not resolved. `tools/resolve-poses.py` decided this once and wrote
    // it into sheets.json, so a human can look at Onix and disagree -- which
    // was impossible while the answer fell out of a priority list at runtime.
    //
    // Shared with the guide's lane animation rather than duplicated: two
    // copies of this order is two chances for the guide to show a creature
    // doing something it never does in a match.
    name = attackAnim(sheetName, action === "Shoot" ? "ranged" : "melee");
  }
  if (!sheet.anims[name]) name = sheet.anims.Idle ? "Idle" : Object.keys(sheet.anims)[0];
  if (!name || !sheet.anims[name]) return undefined;

  // Not every sheet carries all eight directions.
  const dirs = sheet.anims[name];
  const key = String(dir) in dirs ? String(dir) : Object.keys(dirs)[0];
  return ensureAnim(sheetName, name, key);
}
