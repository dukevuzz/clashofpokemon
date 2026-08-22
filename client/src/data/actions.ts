/**
 * Which animation row a creature actually attacks with.
 *
 * Three hundred PMD sheets do not agree on a name. A creature that swings may
 * have "Attack", "Swing", "Slash" or "Strike"; one that punches has "Punch";
 * Machop kicks, Voltorb shocks, and a dozen have only "Shoot". Picking the
 * wrong row is not cosmetic -- twelve forms were once standing in an idle pose
 * while dealing damage, which reads as a bug rather than as a hit.
 *
 * Phaser-free on purpose. The game reads this through `sprites.ts` and the
 * guide reads it directly: the guide is a document and pulling the engine into
 * it once cost three megabytes on a page of text. One list, two readers, and
 * no chance of the guide showing a different animation from the game.
 */

import { SHEETS } from "./sheets";

/**
 * Melee names, in preference order.
 *
 * "Shoot" is last on purpose. It is the wrong animation for a creature that
 * swings -- but it is *an* animation, and the alternative is standing still
 * while dealing damage. Every eeveelution except Flareon and Umbreon, both
 * Onix stages, Bagon, Salamence, Graveler and Trapinch were doing exactly
 * that while carrying a perfectly good Shoot row.
 */
export const MELEE = [
  "Attack", "Punch", "Hit", "Slap", "Slice", "Strike", "Swing", "Kick",
  "Slam", "Shock", "Shoot",
];

export const RANGED = ["Shoot", "Attack", "Special", "Charge", "Swing"];

export const WALK = ["Walk", "Hop", "Idle"];

export function actionFor(sheetName: string, kind: "melee" | "ranged"): string | undefined {
  const sheet = SHEETS[sheetName];
  if (!sheet) return undefined;
  for (const name of kind === "melee" ? MELEE : RANGED) {
    if (sheet.anims[name]) return name;
  }
  return undefined;
}

/**
 * The animation a creature attacks with — the stored answer first.
 *
 * Every sheet declares its own `attack` and `shoot` rows, decided once by
 * resolved ahead of time and written into sheets.json so a human can look at
 * Onix and disagree. The priority lists above are the fallback for a sheet
 * that never got one, not the primary answer.
 *
 * Getting this order wrong is not subtle: the lists start at "Attack", so a
 * creature whose stored pose is "Kick" or "Shock" would quietly play something
 * else in the guide from the one it plays in a match.
 */
export function attackAnim(sheetName: string, kind: "melee" | "ranged"): string {
  const sheet = SHEETS[sheetName];
  if (!sheet) return "Idle";
  const stored = kind === "ranged" ? sheet.shoot : sheet.attack;
  const name = stored ?? actionFor(sheetName, kind) ?? "Idle";
  // A stored name still has to exist on the sheet; falling through to Idle
  // rather than drawing nothing at all.
  if (sheet.anims[name]) return name;
  return sheet.anims.Idle ? "Idle" : Object.keys(sheet.anims)[0] ?? "Idle";
}

/**
 * The animation a creature uses for its skill.
 *
 * The sheets record an `ability` row, and falling back to the attack is what
 * every creature did for both before that row existed. The guide shows this
 * after the basic attack, because the skill is usually the reason a card is
 * worth playing and a strip that never shows it is showing half the card.
 */
export function castAnim(sheetName: string): string {
  const sheet = SHEETS[sheetName];
  if (!sheet) return "Idle";
  const name = sheet.ability ?? sheet.attack ?? sheet.shoot ?? "Idle";
  if (sheet.anims[name]) return name;
  return sheet.anims.Idle ? "Idle" : Object.keys(sheet.anims)[0] ?? "Idle";
}

/** The first of these names the sheet actually has. */
export function firstAnim(sheetName: string, names: string[]): string | undefined {
  const sheet = SHEETS[sheetName];
  if (!sheet) return undefined;
  return names.find((n) => sheet.anims[n]);
}
