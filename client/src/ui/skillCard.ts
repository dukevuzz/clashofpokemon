import Phaser from "phaser";
/**
 * The animated ability preview.
 *
 * The wording and the numbers moved to `skillText.ts` so that anything which
 * only wants to *describe* an ability -- the guide, chiefly -- does not drag
 * Phaser in behind it. Re-exported here because every existing caller asks
 * this module for both.
 */

import type { Card } from "../core/cards";
import * as sprites from "./sprites";

export { skillOf, fxKeyFor, type SkillInfo } from "./skillText";
import { fxKeyFor } from "./skillText";

/** The card doing the thing, on a loop. */
export function playPreview(
  scene: Phaser.Scene,
  into: Phaser.GameObjects.Container,
  card: Card,
  x: number,
  y: number,
  size: number,
): Phaser.Time.TimerEvent | undefined {
  if (!scene.textures.exists(`pm-${card.sheet}`)) return undefined;

  const sheet = sprites.SHEETS[card.sheet];
  const art = scene.add.sprite(x, y, `pm-${card.sheet}`);
  if (sheet) art.setScale(Math.min(size / sheet.bodyWidth, size / sheet.bodyHeight, 2.4));
  into.add(art);

  // Facing away from the viewer, so an attack reads as aimed up the board the
  // way it will be in a match.
  const pose = card.range > 30 ? "Shoot" : "Attack";
  const act = sprites.resolve(card.sheet, pose, 4) ?? sprites.resolve(card.sheet, "Idle", 4);
  const idle = sprites.resolve(card.sheet, "Idle", 4);
  const fx = fxKeyFor(card);
  if (idle) art.play(idle, true);

  let phase = 0;
  // A repeating timer rather than chained callbacks: flicking between cards
  // cannot then leave two cycles running over each other.
  return scene.time.addEvent({
    delay: 900,
    loop: true,
    callback: () => {
      // The timer outlives nothing it owns, so it verifies rather than
      // assumes. A destroyed sprite still answers to `.play`, but its `anims`
      // is gone -- which surfaces as "Cannot read properties of undefined
      // (reading 'play')" from inside a callback, several frames after the
      // screen that caused it has moved on.
      if (!art.scene || !art.active) return;
      phase = (phase + 1) % 2;
      if (phase === 1) {
        if (act) art.play(act, true);
        if (fx && scene.anims.exists(fx)) {
          const burst = scene.add.sprite(x, y, "__DEFAULT").setScale(size / 64);
          into.add(burst);
          burst.play(fx);
          burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
        }
      } else if (idle) {
        art.play(idle, true);
      }
    },
  });
}
