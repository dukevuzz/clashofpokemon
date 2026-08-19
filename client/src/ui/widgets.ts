/** The shapes every screen is built from. */

import Phaser from "phaser";
import { C, style, hex } from "./theme";

const RADIUS = 12;
const BEVEL = 6;

/** Make a container clickable where it is actually drawn. */
export function hitTopLeft(
  c: Phaser.GameObjects.Container, w: number, h: number,
): Phaser.GameObjects.Container {
  c.setSize(w, h);
  c.setInteractive(new Phaser.Geom.Rectangle(w / 2, h / 2, w, h),
                   Phaser.Geom.Rectangle.Contains);
  // Set here rather than by a second setInteractive call. `setInteractive`
  // takes its first argument as the hit area, so passing a config object
  // afterwards -- `.setInteractive({ useHandCursor: true })` -- makes Phaser
  // build a fresh default rectangle and throw this one away. Both call sites
  // did exactly that, so the fix above was being undone on the same line and
  // the deck screen still picked the neighbouring card.
  if (c.input) c.input.cursor = "pointer";
  return c;
}

/** A panel, built the way pokemonAutoChess builds one. */
export function panel(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  fill: number = C.panel,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // Hard offset shadow, in the shadow colour.
  g.fillStyle(C.edge, 1);
  g.fillRoundedRect(x + 3, y + 3, w, h, RADIUS);
  // The bevel sits underneath and the face is drawn short of it, so the shade
  // shows along the bottom-right without needing a stencil Phaser lacks.
  g.fillStyle(C.panelDim, 1);
  g.fillRoundedRect(x, y, w, h, RADIUS);
  g.fillStyle(fill, 1);
  g.fillRoundedRect(x, y, w - BEVEL, h - BEVEL, RADIUS - 2);
  g.lineStyle(3, 0x000000, 1);
  g.strokeRoundedRect(x, y, w, h, RADIUS);
  return g;
}

export interface ButtonOptions {
  /** A second line under the label, for a hint or a count. */
  sub?: string;
  /** Dimmed and unclickable. */
  disabled?: boolean;
}

/** A pressable button. */
export function button(
  scene: Phaser.Scene,
  cx: number, cy: number, w: number, h: number,
  label: string, size: number, fill: number,
  onClick: () => void,
  opts: ButtonOptions = {},
): Phaser.GameObjects.Container {
  const bevelColour = Phaser.Display.Color.IntegerToColor(fill).darken(28).color;
  const hoverColour = Phaser.Display.Color.IntegerToColor(fill).brighten(14).color;

  const g = scene.add.graphics();
  const paint = (face: number, pressed: boolean) => {
    g.clear();
    // Hard offset shadow in the shadow colour -- PAC's `--shadow-clickable`,
    // which is `#2d334b 2px 2px 0px` and deliberately unblurred. It disappears
    // when pressed, so the button physically sits down.
    if (!pressed) {
      g.fillStyle(C.edge, 1);
      g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w, h, RADIUS);
    }
    // Bevel: bottom-right normally, top-left when pressed.
    g.fillStyle(bevelColour, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, RADIUS);
    const dx = pressed ? BEVEL : 0;
    const dy = pressed ? BEVEL : 0;
    g.fillStyle(face, 1);
    g.fillRoundedRect(-w / 2 + dx, -h / 2 + dy, w - BEVEL, h - BEVEL, RADIUS - 2);
    // Black, like PAC's --border-thin. C.edge against the face is two shades
    // apart and reads as no border at all.
    g.lineStyle(2, 0x000000, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, RADIUS);
  };
  paint(fill, false);

  const labelY = opts.sub ? -h / 2 + h * 0.32 : -BEVEL / 2;
  const text = scene.add
    .text(-BEVEL / 2, labelY, label, style(size, C.text, "bold", true))
    .setOrigin(0.5);

  const parts: Phaser.GameObjects.GameObject[] = [g, text];
  if (opts.sub) {
    parts.push(
      scene.add.text(-BEVEL / 2, h / 2 - h * 0.30, opts.sub, style(size * 0.5, C.dim))
        .setOrigin(0.5),
    );
  }

  const c = scene.add.container(cx, cy, parts);
  c.setSize(w, h);
  if (opts.disabled) {
    c.setAlpha(0.45);
    return c;
  }

  c.setInteractive({ useHandCursor: true });
  // Feedback on press, not only on hover: a touchscreen has no hover, and
  // without it a tap that misses feels identical to one that lands.
  c.on("pointerover", () => paint(hoverColour, false));
  c.on("pointerout", () => paint(fill, false));
  c.on("pointerdown", () => paint(fill, true));
  c.on("pointerup", () => {
    paint(fill, false);
    onClick();
  });
  return c;
}

/** A small pill, for filters and toggles. */
export function chip(
  scene: Phaser.Scene,
  cx: number, cy: number, w: number, h: number,
  label: string, active: boolean, fill: number,
  onClick: () => void,
): { container: Phaser.GameObjects.Container; setActive: (on: boolean) => void } {
  const g = scene.add.graphics();
  const text = scene.add.text(0, 0, label, style(h * 0.42, C.dim)).setOrigin(0.5);

  const paint = (on: boolean) => {
    g.clear();
    g.fillStyle(on ? fill : C.panelDim, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.lineStyle(2, 0x000000, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    text.setColor(on ? hex(C.text) : hex(C.dim));
  };
  paint(active);

  const c = scene.add.container(cx, cy, [g, text]);
  c.setSize(w, h).setInteractive({ useHandCursor: true });
  c.on("pointerup", onClick);
  return { container: c, setActive: paint };
}

/** A left-aligned label with a dim caption under it. */
export function labelled(
  scene: Phaser.Scene, x: number, y: number,
  title: string, caption: string, size = 16,
): Phaser.GameObjects.Text[] {
  return [
    scene.add.text(x, y, title, style(size, C.text, "bold")),
    scene.add.text(x, y + size + 3, caption, style(size - 4, C.dim)),
  ];
}
