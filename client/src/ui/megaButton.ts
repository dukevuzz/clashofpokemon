/**
 * The Mega button: a Key Stone that charges.
 *
 * Drained and cold until you can pay, colour rising over it as elixir arrives,
 * ringed and breathing once it is ready. The charge is the whole readout -- a
 * player mid-push should not have to read a number to know whether the button
 * is live.
 *
 * The lit copy is revealed over a desaturated one rather than the stone simply
 * brightening, so the symbol stays readable at every charge level.
 *
 * Hidden entirely unless the deck's Mega slot holds a card that can Mega, so a
 * deck without one is not carrying dead furniture on screen.
 */

import Phaser from "phaser";
import { config } from "../core/config";
import * as mega from "../core/mega";
import type { Match } from "../core/match";
import type { Side } from "../core/config";

const ICON = 48;

export class MegaButton {
  private g: Phaser.GameObjects.Graphics;
  private hit: Phaser.GameObjects.Arc;
  private ready = false;
  private pulse = 0;

  private cold!: Phaser.GameObjects.Image;
  private lit!: Phaser.GameObjects.Image;
  private reveal!: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private x: number,
    private y: number,
    private match: Match,
    private me: Side,
    private onPress: () => void,
  ) {
    this.g = scene.add.graphics().setDepth(59).setPosition(x, y);

    // Cold underneath, lit on top with a mask that rises as elixir arrives.
    // Revealing colour over a drained copy keeps the symbol readable the whole
    // time, where a stone that only brightens is unidentifiable while dark.
    this.cold = scene.add.image(x, y, "mega-stone", 0).setDepth(60);
    this.lit = scene.add.image(x, y, "mega-stone", 1).setDepth(61);
    this.reveal = scene.make.graphics({}, false);
    this.lit.setMask(this.reveal.createGeometryMask());

    this.hit = scene.add
      .circle(x, y, ICON / 2, 0xffffff, 0)
      .setDepth(63)
      .setInteractive({ useHandCursor: true });
    this.hit.on("pointerdown", () => {
      if (this.ready) this.onPress();
    });
    this.redraw(0);
  }

  /** Called every frame; the charge has to track elixir continuously. */
  update() {
    const show = mega.canEverMega(this.match.megaPick[this.me]);
    for (const o of [this.g, this.hit, this.cold, this.lit]) o.setVisible(show);
    if (!show) return;

    const has = mega.megaTarget(this.match, this.me) !== undefined;
    const paid = Math.min(1, this.match.elixir[this.me] / config.megaCost);
    // Both, so the stone never looks ready while there is nothing on the board
    // to spend it on. With nothing out it still charges, dimly, so the player
    // can see the elixir is there and the unit is what is missing.
    this.ready = has && paid >= 1;
    if (this.ready) this.pulse += 0.08;
    this.redraw(has ? paid : paid * 0.3);
  }

  private redraw(charge: number) {
    const half = ICON / 2;
    this.reveal.clear();
    this.reveal.fillStyle(0xffffff, 1);
    this.reveal.fillRect(this.x - half, this.y + half - ICON * charge, ICON, ICON * charge);

    const g = this.g;
    g.clear();
    const breath = this.ready ? 1 + Math.sin(this.pulse) * 0.05 : 1;
    // A ring only once it is live: a halo around a cold stone reads as ready.
    if (this.ready) {
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(0, 0, half * breath + 2);
    }
  }

  destroy() {
    this.g.destroy();
    this.hit.destroy();
    this.cold.destroy();
    this.lit.destroy();
    this.reveal.destroy();
  }
}
