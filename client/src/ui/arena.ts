/** The arena's ground, and the towers standing on it. */

import Phaser from "phaser";
import terrainJson from "../data/terrain.json";
import groundJson from "../data/ground.json";
import forestJson from "../data/ground-forest.json";
import meadowJson from "../data/ground-meadow.json";
import ampJson from "../data/ground-amp.json";
import magmaJson from "../data/ground-magma.json";
import { config } from "../core/config";
import { ARENA_SCALE, ARENA_X, ARENA_Y, DESIGN_W, DESIGN_H } from "./layout";
import { C } from "./theme";

interface GroundInfo { sheet: string; tiles: number }
/** Two different points, in source pixels from the art's top-left, and they were one field for far too long. */
interface TowerInfo {
  sheet: string; w: number; h: number; mount: number[]; seat: number[];
}

const TERRAIN = terrainJson as {
  tileSize: number;
  ground: Record<string, GroundInfo>;
  towers: Record<string, TowerInfo>;
};

export const TOWER_ART = TERRAIN.towers;

interface GroundSheet {
  tile: number;
  grassPlain: number[]; grassTuft: number[]; dirt: number[];
  dirtEdgeL: number[]; dirtEdgeR: number[];
  water: Record<string, number>;
}

/** Which pictures the surfaces are drawn with. The surfaces themselves never change. */
const THEMES: Record<string, { sheet: GroundSheet; file: string }> = {
  forest: { sheet: forestJson as GroundSheet, file: "ground-forest.png" },
  meadow: { sheet: meadowJson as GroundSheet, file: "ground-meadow.png" },
  amp: { sheet: ampJson as GroundSheet, file: "ground-amp.png" },
  magma: { sheet: magmaJson as GroundSheet, file: "ground-magma.png" },
  // The hand-made set the game shipped with, kept so the change is reversible.
  classic: { sheet: groundJson as GroundSheet, file: "ground.png" },
};

/** The ones a match may be dealt. `classic` is kept for comparison, not play. */
export const IN_ROTATION = ["forest", "meadow", "amp", "magma"];

/** What to call an arena in front of a player. */
export const ARENA_NAMES: Readonly<Record<string, string>> = {
  forest: "Verdant Wood",
  meadow: "Open Meadow",
  amp: "Amp Plains",
  magma: "Magma Cavern",
  classic: "Classic",
};

let THEME = "forest";
const sheetOf = () => THEMES[THEME].sheet;

/** Which arena this match was dealt. */
export const currentTheme = () => THEME;

/** Seeded from the match id, not `match.rng` -- drawing from that would desync the engines. */
export function pickTheme(matchId?: string) {
  const forced = new URLSearchParams(location.search).get("theme");
  if (forced && forced in THEMES) { THEME = forced; return THEME; }

  let h = 0x811c9dc5;
  for (const ch of matchId ?? String(Math.floor(Math.random() * 1e9))) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  THEME = IN_ROTATION[h % IN_ROTATION.length];
  return THEME;
}

/** How often a grass square carries blades rather than being flat. */
const TUFT_CHANCE = 0.16;

export function preload(load: Phaser.Loader.LoaderPlugin) {
  // One strip of 16px cells: grass fills, tufted variants, dirt, baked lane
  // edges, and the water ring.
  // All of them, ~50 KB, so the board can be dealt after loading.
  for (const [name, { sheet, file }] of Object.entries(THEMES)) {
    load.spritesheet(`ground:${name}`, `tiles/${file}`,
                     { frameWidth: sheet.tile, frameHeight: sheet.tile });
  }
  // One per side: the banner is baked into the art, so "theirs" and "ours" are
  // two files rather than one file and a tint.
  for (const info of Object.values(TERRAIN.towers)) {
    for (const side of ["player", "enemy"]) {
      load.image(`tower-${info.sheet}-${side}`, `tiles/${info.sheet}_${side}.png`);
    }
  }
}

type Surface = "grass" | "sand" | "road" | "water";

/** Which surface a point belongs to. */
function surfaceAt(x: number, y: number): Surface {
  const riverTop = config.riverY - config.riverHeight / 2;
  const riverBot = config.riverY + config.riverHeight / 2;
  if (y > riverTop && y < riverBot) return "water";

  // The road is the crossing strip itself, not the tower line -- so the planks
  // meet the track feeding them. A tower is wide enough to cover it off-centre.
  for (const bx of config.bridgeX) {
    if (Math.abs(x - bx) < config.bridgeHalfWidth) return "road";
  }
  return y < config.riverY ? "sand" : "grass";
}

/** Paint the ground once into a texture. */
export function buildGround(scene: Phaser.Scene): Phaser.GameObjects.RenderTexture {
  const w = config.arenaWidth;
  const h = config.arenaHeight;
  const rt = scene.add.renderTexture(ARENA_X, ARENA_Y, w, h).setOrigin(0, 0);
  rt.setScale(ARENA_SCALE);
  rt.setDepth(-10);

  // The art is 16px, so the board is tiled on its own grid rather than the
  // 24px world tile. Grass goes down everywhere first and the rest is drawn
  // over it, which is what lets a lane edge or a river bank be a cut-out.
  const G = sheetOf().tile;
  const cols = Math.ceil(w / G);
  const rows = Math.ceil(h / G);

  // Deterministic, so a replay -- and eventually two clients -- lay the same
  // field. Math.random here would give every player a different board.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  const pick = (a: number[]) => a[Math.floor(rand() * a.length) % a.length];
  const at = (tx: number, ty: number) => surfaceAt(tx * G + G / 2, ty * G + G / 2);
  const wet = (tx: number, ty: number) =>
    tx >= 0 && ty >= 0 && tx < cols && ty < rows && at(tx, ty) === "water";

  rt.beginDraw();
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x = tx * G, y = ty * G;
      rt.batchDrawFrame(`ground:${THEME}`,
        rand() < TUFT_CHANCE ? pick(sheetOf().grassTuft) : pick(sheetOf().grassPlain), x, y);

      if (at(tx, ty) === "water") {
        const k = `${wet(tx, ty - 1) ? 1 : 0}${wet(tx + 1, ty) ? 1 : 0}` +
                  `${wet(tx, ty + 1) ? 1 : 0}${wet(tx - 1, ty) ? 1 : 0}`;
        rt.batchDrawFrame(`ground:${THEME}`, sheetOf().water[k] ?? sheetOf().water["1111"], x, y);
      }
    }
  }

  // On the crossing's alignment, not the tile grid's: `bridgeX` divides into
  // neither tile size, and snapping to the grid drew a road narrower than its
  // own bridge. Dirt is full-bleed, so its seams do not show.
  const wide = Math.max(1, Math.ceil((config.bridgeHalfWidth * 2) / G));
  for (const bx of config.bridgeX) {
    const start = bx - (wide * G) / 2;
    for (let ty = 0; ty < rows; ty++) {
      const y = ty * G;
      if (at(0, ty) === "water" || surfaceAt(bx, y + G / 2) === "water") continue;
      for (let i = 0; i < wide; i++) {
        rt.batchDrawFrame(`ground:${THEME}`, pick(sheetOf().dirt), start + i * G, y);
      }
    }
  }
  rt.endDraw();
  return rt;
}

/** Where two surfaces meet a hard tile edge looks like a seam, so a soft line along the boundary reads as a transition instead. */
/**
 * A picture of an arena, for the menu to show.
 *
 * Drawn by the same code that draws the real board and captured off the
 * canvas, rather than shipped as four screenshots: the arenas were redrawn
 * once already, and a stale picture of a board is exactly the sort of thing
 * nobody notices for a month.
 *
 * The whole composition is captured, not just the ground texture -- the
 * bridges and lane edges are separate objects drawn over it, and a river with
 * no crossings is a picture of a board this game does not have.
 *
 * Everything drawn for the capture is destroyed again. Nothing shows in the
 * meantime because the menu is an opaque DOM layer over the canvas.
 */
export function preview(
  scene: Phaser.Scene,
  theme: string,
): Promise<{ theme: string; src: string }> {
  const was = THEME;
  if (theme in THEMES) THEME = theme;

  const before = new Set(scene.children.list);
  drawSurround(scene);
  buildGround(scene);
  drawEdgesAndBridges(scene);
  const made = scene.children.list.filter((o) => !before.has(o));

  return new Promise((resolve) => {
    const w = config.arenaWidth * ARENA_SCALE;
    const h = config.arenaHeight * ARENA_SCALE;
    // On the frame *after* this one: the objects above have been added but
    // not yet rendered, and capturing now would photograph the frame before
    // they existed.
    scene.game.renderer.snapshotArea(ARENA_X, ARENA_Y, w, h, (image) => {
      for (const o of made) o.destroy();
      THEME = was;
      resolve({ theme, src: (image as HTMLImageElement).src });
    });
  });
}

export function drawEdgesAndBridges(scene: Phaser.Scene) {
  const g = scene.add.graphics().setDepth(-9);
  const toX = (x: number) => ARENA_X + x * ARENA_SCALE;
  const toY = (y: number) => ARENA_Y + y * ARENA_SCALE;
  const S = ARENA_SCALE;
  const W = config.arenaWidth * S;

  const riverTop = config.riverY - config.riverHeight / 2;


  // The painted river bank and the ragged lane edges replaced what used to be
  // here: a dark line drawn along each boundary to disguise a hard tile seam.
  // Drawing both would put a straight line back over the very edges that exist
  // to break it up.

  // Bridges, drawn from the same two numbers the physics crosses at.
  //
  // This used to snap `laneX +/- 18` to the ground grid and keep the result to
  // itself, which is how the core came to have no idea where a crossing was --
  // and a river nothing could locate is a river nothing can enforce. The offset
  // that snapping produced is now in config as `bridgeX`, so the planks a
  // player sees and the strip a unit may walk on are one definition.
  const top = riverTop;
  const bh = config.riverHeight;
  for (let i = 0; i < config.bridgeX.length; i++) {
    const lx = config.bridgeX[i];
    const bw = config.bridgeHalfWidth * 2;
    g.fillStyle(0x665c52, 1);
    g.fillRect(toX(lx - bw / 2 - 2), toY(top - 5), (bw + 4) * S, (bh + 10) * S);
    g.fillStyle(0x8c6b47, 1);
    g.fillRect(toX(lx - bw / 2), toY(top - 3), bw * S, (bh + 6) * S);
    // Planks.
    for (let i = 0; i <= 8; i++) {
      const y = top - 3 + i * ((bh + 6) / 8);
      g.fillStyle(0x57402a, 0.55);
      g.fillRect(toX(lx - bw / 2), toY(y), bw * S, Math.max(1, S));
    }
    g.fillStyle(0x61472e, 1);
    g.fillRect(toX(lx - bw / 2), toY(top - 3), 3 * S, (bh + 6) * S);
    g.fillRect(toX(lx + bw / 2 - 3), toY(top - 3), 3 * S, (bh + 6) * S);
  }

  // The deploy line: everything below it is yours.
  g.fillStyle(C.player, 0.25);
  g.fillRect(toX(0), toY(config.arenaHeight / 2 + config.deployMargin), W, Math.max(1, S));
}

/** The one part of the ground that moves. */
export class WaterShimmer {
  private g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(-8);
  }

  update(time: number) {
    const S = ARENA_SCALE;
    const top = config.riverY - config.riverHeight / 2;
    this.g.clear();
    this.g.fillStyle(0xd9f0ff, 0.13);
    for (let i = 0; i <= 4; i++) {
      const y = top + 5 + i * 3;
      const offset = Math.sin(time * 1.1 + i * 0.9) * 8;
      for (let x = -20; x < config.arenaWidth; x += 26) {
        // The row starts off the left edge so the drift has somewhere to come
        // from, which means each streak has to be clipped to the board -- an
        // unclipped one painted over the surround beside the river.
        const x0 = Math.max(0, x + offset + (i % 2) * 13);
        const x1 = Math.min(config.arenaWidth, x + offset + (i % 2) * 13 + 11);
        if (x1 <= x0) continue;
        this.g.fillRect(ARENA_X + x0 * S, ARENA_Y + y * S, (x1 - x0) * S, Math.max(1, S));
      }
    }
  }
}

/** Behind the arena: a dark surround that frames the board instead of leaving a black void either side of it. */
export function drawSurround(scene: Phaser.Scene) {
  const g = scene.add.graphics().setDepth(-20);
  g.fillStyle(0x121218, 1);
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.fillStyle(0xffffff, 0.014);
  for (let x = -DESIGN_H; x < DESIGN_W; x += 22) {
    g.fillPoints(
      [
        new Phaser.Geom.Point(x, DESIGN_H),
        new Phaser.Geom.Point(x + 11, DESIGN_H),
        new Phaser.Geom.Point(x + 11 + DESIGN_H, 0),
        new Phaser.Geom.Point(x + DESIGN_H, 0),
      ],
      true,
    );
  }
}
