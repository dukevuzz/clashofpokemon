/** A card face, everywhere one is drawn. */

import Phaser from "phaser";
import type { Card } from "../core/cards";
import { RARITY_RANK, RARITY_SHORT } from "../core/tiers";
import { TYPE_COLORS, TYPE_SHORT } from "../core/species";
import { C, style, px, rarityColor, hex } from "./theme";
import * as sprites from "./sprites";
import * as portraits from "./portraits";
import { hitTopLeft } from "./widgets";

const asColour = (rgb?: number[]): number =>
  rgb ? Phaser.Display.Color.GetColor(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255) : 0x999999;

/** Named types, where there is room for words. */
export function typeChips(
  scene: Phaser.Scene, cx: number, y: number, types: string[], size = 9,
): Phaser.GameObjects.GameObject[] {
  if (types.length === 0) return [];
  const out: Phaser.GameObjects.GameObject[] = [];
  const pad = 5;

  const widths = types.map((t) => (TYPE_SHORT[t] ?? t).length * (size * 0.62) + pad * 2);
  const total = widths.reduce((a, b) => a + b, 0) + (types.length - 1) * 3;

  let x = cx - total / 2;
  types.forEach((t, i) => {
    const w = widths[i];
    const col = Phaser.Display.Color.IntegerToColor(asColour(TYPE_COLORS[t])).darken(20).color;
    out.push(scene.add.rectangle(x + w / 2, y + 6, w, 13, col));
    out.push(
      scene.add
        .text(x + w / 2, y + 6, TYPE_SHORT[t] ?? t, style(size, C.text, "bold"))
        .setOrigin(0.5),
    );
    x += w + 3;
  });
  return out;
}

export interface CardFaceOptions {
  width: number;
  height: number;
  /** Dim it and grey the art: you can still see what you are saving for. */
  affordable?: boolean;
  selected?: boolean;
  /** Progress toward the next form, drawn as pips. */
  progress?: { done: number; needed: number };
  showRole?: boolean;
  /** A live price that differs from the printed one -- Ditto only. */
  priceOverride?: number;
  /** What a copy card would put down right now. */
  copyOf?: string;
}

/** One card, as a Container positioned by its top-left corner. */
export class CardFace {
  readonly container: Phaser.GameObjects.Container;
  private box: Phaser.GameObjects.Rectangle;
  private body: Phaser.GameObjects.Graphics;
  private lastPaint = "";
  private dim: Phaser.GameObjects.Rectangle;
  private art: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private roleText: Phaser.GameObjects.Text;
  private costBadge: Phaser.GameObjects.Arc;
  private costText: Phaser.GameObjects.Text;
  private strip: Phaser.GameObjects.Rectangle;
  private rarityMark: Phaser.GameObjects.Text;
  private chips: Phaser.GameObjects.GameObject[] = [];
  private pips: Phaser.GameObjects.Arc[] = [];
  private ready?: Phaser.GameObjects.Rectangle;
  private card?: Card;

  constructor(
    private scene: Phaser.Scene,
    public x: number,
    public y: number,
    private opts: CardFaceOptions,
  ) {
    const { width: w, height: h } = opts;

    // The body is drawn, not a rectangle, so it can carry a rarity tint, a
    // rounded corner and a bevel. PAC tints the whole card by rarity rather
    // than outlining it -- at four cards wide you read the fill instantly and
    // have to hunt for a 2px border.
    this.body = scene.add.graphics();
    this.box = scene.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0).setStrokeStyle(0, 0);
    this.art = scene.add.sprite(w / 2, (h - 82) / 2 + 10, "__DEFAULT");
    this.dim = scene.add.rectangle(w / 2, h / 2, w, h, 0x121218, 0).setVisible(false);

    this.nameText = scene.add.text(w / 2, h - 44, "", px(11)).setOrigin(0.5, 0);
    this.roleText = scene.add.text(w / 2, h - 22, "", style(10, C.dim)).setOrigin(0.5, 0);

    // Rarity as a coloured bar along the card's foot. A bar rather than a word
    // because rarity is a ranking, and a colour you can compare at a glance
    // across four cards beats four words you have to read.
    this.strip = scene.add.rectangle(w / 2, h - 5, w - 8, 3, C.dim);
    // Top tiers get their initial too, in the header beside the slot number --
    // it used to sit on the role line and overprint it, so "skirmisher" and an
    // epic "E" rendered as one word.
    this.rarityMark = scene.add.text(w - 30, 5, "", style(11, C.dim, "bold"));

    this.costBadge = scene.add.circle(15, 16, 13, C.elixir).setStrokeStyle(2, C.edge);
    this.costText = scene.add.text(15, 16, "", px(13)).setOrigin(0.5);

    this.container = scene.add.container(x, y, [
      this.body, this.box, this.art, this.dim, this.nameText, this.roleText,
      this.strip, this.rarityMark, this.costBadge, this.costText,
    ]);
    hitTopLeft(this.container, w, h);
  }

  setInteractive(onClick: () => void) {
    // The hit area is already shaped by hitTopLeft in the constructor; asking
    // for the default here would put the offset straight back.
    this.container.setInteractive(this.container.input!.hitArea,
                                  Phaser.Geom.Rectangle.Contains);
    this.container.input!.cursor = "pointer";
    this.container.on("pointerup", onClick);
    return this;
  }

  setVisible(v: boolean) {
    this.container.setVisible(v);
    return this;
  }

  setPosition(x: number, y: number) {
    this.x = x; this.y = y;
    this.container.setPosition(x, y);
    return this;
  }

  update(card: Card | undefined, opts: Partial<CardFaceOptions> = {}) {
    const { width: w, height: h } = this.opts;
    const affordable = opts.affordable ?? true;
    const selected = opts.selected ?? false;

    this.container.setVisible(Boolean(card));
    if (!card) return;

    // A copy card re-renders every frame, because its target can change.
    const changed = this.card?.id !== card.id || Boolean(card.copies);
    this.card = card;

    if (changed) {
      this.nameText.setText(card.name);
      this.costText.setText(String(card.elixir));

      // Art. The creature occupies a small part of an 80x80 PMD frame, so the
      // sprite is scaled to its body box rather than to the frame.
      // The portrait first: a card is a still image, and PAC's hand-drawn
      // 40x40 face is drawn for exactly that. The animated walk frame below is
      // the fallback for anything without one.
      if (!portraits.apply(this.art, card.sheet, w - 10, h - 88)) {
        const sheet = sprites.SHEETS[card.sheet];
        if (sheet && this.scene.textures.exists(`pm-${card.sheet}`)) {
          // With a frame, always. A packed atlas has no meaningful default
          // frame, so setting the texture alone would draw the whole sheet for
          // however long it took an animation to start -- and forever if none
          // resolved.
          const first = sprites.resolve(card.sheet, "Idle", 0);
          if (!first) { this.art.setVisible(false); return; }
          this.art.setTexture(`pm-${card.sheet}`, "Idle-0-0");
          const zoom = Math.min(
            (w - 10) / (sheet.bodyWidth * 1.6),
            (h - 88) / (sheet.bodyHeight * 1.6),
          );
          this.art.setScale(zoom).setVisible(true);
          const idle = sprites.resolve(card.sheet, "Idle", 0);
          if (idle) this.art.play(idle, true);
        } else {
          this.art.setVisible(false);
        }
      }

      this.strip.setFillStyle(rarityColor(card.rarity));
      const rank = RARITY_RANK[card.rarity] ?? 1;
      this.rarityMark
        .setText(rank >= 4 ? RARITY_SHORT[card.rarity] ?? "" : "")
        .setColor(hex(rarityColor(card.rarity)));

      this.roleText.setText(
        (card.count > 1 ? `x${card.count}  ` : "") + card.role + (card.flying ? "  air" : ""),
      );

      for (const c of this.chips) c.destroy();
      this.chips = typeChips(this.scene, w / 2, h - 64, card.types);
      this.container.add(this.chips);
    }

    // A copy card wears its target's name and live cost, because "Ditto" tells
    // you nothing about what is going to walk out.
    if (card.copies) {
      const price = opts.priceOverride;
      this.costText.setText(price === undefined || !Number.isFinite(price) ? "?" : String(price));
      this.nameText.setText(opts.copyOf ? `→ ${opts.copyOf}` : "Ditto");
      this.roleText.setText(opts.copyOf ? "copy" : "play a card first");
    }

    this.dim.setVisible(!affordable).setFillStyle(0x121218, affordable ? 0 : 0.55);
    this.nameText.setAlpha(affordable ? 0.95 : 0.5);
    this.art.setAlpha(affordable ? 1 : 0.4);

    this.paintBody(card, selected);

    this.setPips(opts.progress);
  }

  /** The card body: a rarity-tinted face on a darker bevel, gold-rimmed when chosen. */
  private paintBody(card: Card, selected: boolean) {
    const key = `${card.rarity}:${selected}`;
    if (key === this.lastPaint) return;
    this.lastPaint = key;

    const { width: w, height: h } = this.opts;
    const rc = rarityColor(card.rarity);
    const face = Phaser.Display.Color.IntegerToColor(rc).darken(72).color;
    const bevel = Phaser.Display.Color.IntegerToColor(rc).darken(84).color;

    const g = this.body;
    g.clear();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(2, 5, w, h, 10);
    g.fillStyle(bevel, 1);
    g.fillRoundedRect(0, 0, w, h, 10);
    g.fillStyle(face, 1);
    g.fillRoundedRect(0, 0, w, h - 5, 10);
    // The rarity reads as a band along the top, where the eye lands first.
    g.fillStyle(rc, 0.85);
    g.fillRoundedRect(0, 0, w, 5, { tl: 10, tr: 10, bl: 0, br: 0 });
    g.lineStyle(selected ? 3 : 2, selected ? C.gold : C.edge, 1);
    g.strokeRoundedRect(0, 0, w, h, 10);
  }

  /** Progress toward the next form, one pip per play still owed. */
  private setPips(progress?: { done: number; needed: number }) {
    for (const p of this.pips) p.destroy();
    this.pips = [];
    this.ready?.destroy();
    this.ready = undefined;
    if (!progress) return;

    const { done, needed } = progress;
    const r = 3, gap = 3;
    const total = needed * (r * 2) + (needed - 1) * gap;
    let x = this.opts.width / 2 - total / 2 + r;
    const y = this.opts.height - 76;

    for (let i = 0; i < needed; i++) {
      const filled = i < done;
      const pip = this.scene.add.circle(x, y, r, C.gold, filled ? 1 : 0);
      if (!filled) pip.setStrokeStyle(1, 0xffffff, 0.22);
      this.pips.push(pip);
      this.container.add(pip);
      x += r * 2 + gap;
    }

    // One play away: say so, because that is the moment a plan forms.
    if (done === needed - 1) {
      this.ready = this.scene.add
        .rectangle(this.opts.width / 2, this.opts.height / 2,
                   this.opts.width - 2, this.opts.height - 2, 0, 0)
        .setStrokeStyle(2, C.gold, 0.8);
      this.container.add(this.ready);
      this.scene.tweens.add({
        targets: this.ready, alpha: 0.3,
        duration: 520, yoyo: true, repeat: -1,
      });
    }
  }

  destroy() {
    this.container.destroy(true);
  }
}
