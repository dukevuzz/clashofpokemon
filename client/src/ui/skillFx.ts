/** What an attack looks like. */

import Phaser from "phaser";
import attacksJson from "../data/attacks.json";
import abilityJson from "../data/abilityFx.json";
import { FRAMES } from "../data/effects";
import { typesOf, TYPE_COLORS } from "../core/species";
import type { Projectile } from "../core/match";
import { ARENA_SCALE, toScreen } from "./layout";

interface FxInfo { sheet: string; w: number; h: number; frames: number }

/** The packed effect atlas: one entry per *frame*, not per strip. */
const STRIPS = { frames: FRAMES };

const ATTACKS = attacksJson as unknown as Record<string, Record<string, FxInfo>>;
const ABILITY_FX = abilityJson as unknown as Record<string, FxInfo>;

/** PAC effects are authored at wildly different sizes -- an 8x8 water droplet, a 72x64 dragon bolt. */
const TARGET_H: Record<string, number> = { range: 17, hit: 22, melee: 21 };
/** The special is the loudest thing on the board and should read as an event. */
const ABILITY_H = 54;

/** One sheet for all 71 effect strips. */
export function preload(load: Phaser.Loader.LoaderPlugin) {
  // One frame per entry now, trimmed to its opaque box, rather than one entry
  // per whole strip. The strips were padded to a uniform cell and 67% of the
  // sheet was empty; an explosion is a handful of pixels in a large cell for
  // most of its animation. Same treatment the creature sheets get, and what PAC
  // does with TexturePacker for this exact art.
  const frames: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(STRIPS.frames)) {
    const [x, y, w, h, ox, oy, sw, sh] = f;
    frames[name] = {
      frame: { x, y, w, h },
      rotated: false,
      trimmed: true,
      // Where it was cut from. Without this a frame that shrinks at the edges
      // slides across the screen as it plays, because Phaser would centre the
      // trimmed box instead of the original cell.
      spriteSourceSize: { x: ox, y: oy, w, h },
      sourceSize: { w: sw, h: sh },
    };
  }
  load.atlas("fx-atlas", "tiles/attacks.png",
             { frames, meta: { image: "attacks.png", scale: "1" } });
}

export function register(
  anims: Phaser.Animations.AnimationManager,
  textures: Phaser.Textures.TextureManager,
) {
  if (!textures.exists("fx-atlas")) return;
  const make = (info: FxInfo, rate: number, repeat: number) => {
    const key = `fx:${info.sheet}`;
    // Frames are named `<sheet>/<index>` in the packed atlas, so an animation
    // is built from names rather than by re-cutting a strip into a grid.
    if (anims.exists(key) || !STRIPS.frames[`${info.sheet}/0`]) return;
    anims.create({
      key,
      frames: Array.from({ length: info.frames }, (_, i) => ({
        key: "fx-atlas", frame: `${info.sheet}/${i}`,
      })).filter((f) => STRIPS.frames[f.frame as string]),
      frameRate: rate,
      repeat,
    });
  };
  for (const kinds of Object.values(ATTACKS)) {
    // A projectile loops while it is in the air; an impact plays once.
    for (const [kind, info] of Object.entries(kinds)) make(info, 20, kind === "range" ? -1 : 0);
  }
  for (const info of Object.values(ABILITY_FX)) make(info, 20, 0);
}

/** The element an effect is drawn in: the first of the creature's types that has frames, so a Ghost/Poison throws ghost fire rather than bubbles. */
function effectSet(species: string): Record<string, FxInfo> | undefined {
  for (const t of typesOf(species)) {
    if (ATTACKS[t]) return ATTACKS[t];
  }
  return undefined;
}

/** One archetype per element family. */
const SHAPE_FOR_TYPE: Record<string, string> = {
  FIRE: "flame", WATER: "droplet", GRASS: "leaf", ELECTRIC: "bolt",
  ICE: "shard", ROCK: "shard", GROUND: "shard", STEEL: "shard",
  PSYCHIC: "wisp", GHOST: "wisp", DARK: "wisp", FAIRY: "wisp",
  POISON: "bubble", BUG: "bubble", FLYING: "wisp",
  FIGHTING: "impact", NORMAL: "impact", DRAGON: "bolt",
};

const asColour = (rgb?: number[]): number =>
  rgb ? Phaser.Display.Color.GetColor(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255) : 0xd9d9e6;

export function shapeFor(species: string): { shape: string; colour: number } {
  for (const t of typesOf(species)) {
    if (SHAPE_FOR_TYPE[t]) return { shape: SHAPE_FOR_TYPE[t], colour: asColour(TYPE_COLORS[t]) };
  }
  return { shape: "impact", colour: 0xd9d9e6 };
}

/** Frames for the impact a species leaves, and for its melee swing. */
export const hitFxFor = (species: string) => effectSet(species)?.hit;
export const meleeFxFor = (species: string) => effectSet(species)?.melee ?? effectSet(species)?.hit;
export const rangeFxFor = (species: string) => effectSet(species)?.range;
export const abilityFxFor = (skill?: string) => (skill ? ABILITY_FX[skill] : undefined);

const scaleFor = (info: FxInfo, kind: string) => (TARGET_H[kind] ?? 20) / info.h;

/** Effects are Phaser display objects driven by tweens rather than a hand-rolled particle list. */
export class SkillFx {
  /** One sprite per live projectile, keyed by the core object itself. */
  private shots = new Map<Projectile, Phaser.GameObjects.GameObject & { x: number; y: number }>();

  constructor(private scene: Phaser.Scene) {}

  /** Draw the shots the core says are in the air. */
  syncProjectiles(projectiles: readonly Projectile[]) {
    const alive = new Set<Projectile>();

    for (const p of projectiles) {
      alive.add(p);
      let view = this.shots.get(p);
      const pos = toScreen(p.x, p.y);

      if (!view) {
        const species = "card" in p.source ? p.source.card.sheet : undefined;
        const boost = p.mult >= 2 ? 1.3 : 1;
        const info = species ? rangeFxFor(species) : undefined;

        if (info) {
          const s = this.scene.add
            .sprite(pos.x, pos.y, `fx-${info.sheet}`)
            .setDepth(21)
            .setScale(scaleFor(info, "range") * ARENA_SCALE * boost);
          s.play(`fx:${info.sheet}`, true);
          view = s;
        } else {
          const { colour } = species ? shapeFor(species) : { colour: 0xffd9a0 };
          view = this.shape(pos.x, pos.y, colour, boost);
        }
        this.shots.set(p, view);
      }

      // A projectile points where it is going; a spinning one reads as debris
      // rather than as something aimed.
      const target = toScreen(p.tx, p.ty);
      if ("setRotation" in view) {
        (view as Phaser.GameObjects.Sprite).setRotation(
          Math.atan2(target.y - pos.y, target.x - pos.x) + Math.PI / 2,
        );
      }
      view.x = pos.x;
      view.y = pos.y;
    }

    // Anything the core has resolved has landed; its sprite goes with it.
    for (const [p, view] of this.shots) {
      if (!alive.has(p)) {
        view.destroy();
        this.shots.delete(p);
      }
    }
  }

  /** The burst where a hit lands. */
  impact(wx: number, wy: number, species: string | undefined, mult: number) {
    const p = toScreen(wx, wy);
    const info = species ? hitFxFor(species) : undefined;
    const boost = mult >= 2 ? 1.4 : 1;

    if (info) {
      const s = this.scene.add
        .sprite(p.x, p.y, `fx-${info.sheet}`)
        .setDepth(22)
        .setScale(scaleFor(info, "hit") * ARENA_SCALE * boost);
      s.play(`fx:${info.sheet}`, true);
      s.once("animationcomplete", () => s.destroy());
      // A stuck animation must not leak a sprite onto the board forever.
      this.scene.time.delayedCall(900, () => s.destroy());
      return;
    }

    const { colour } = species ? shapeFor(species) : { colour: 0xd9d9e6 };
    const ring = this.scene.add.circle(p.x, p.y, 3, colour, 0).setDepth(22);
    ring.setStrokeStyle(2, colour, 0.75);
    this.scene.tweens.add({
      targets: ring,
      radius: (mult >= 2 ? 16 : 9) * ARENA_SCALE,
      alpha: 0, duration: 320,
      onComplete: () => ring.destroy(),
    });
  }

  /** The melee swing, at the point of contact. */
  melee(wx: number, wy: number, species: string) {
    const info = meleeFxFor(species);
    if (!info) return this.impact(wx, wy, species, 1);
    const p = toScreen(wx, wy);
    const s = this.scene.add
      .sprite(p.x, p.y, `fx-${info.sheet}`)
      .setDepth(22)
      .setScale(scaleFor(info, "melee") * ARENA_SCALE);
    s.play(`fx:${info.sheet}`, true);
    s.once("animationcomplete", () => s.destroy());
    this.scene.time.delayedCall(900, () => s.destroy());
  }

  /** A cast is a one-shot animation over the victim. */
  cast(wx: number, wy: number, skill: string, fallback: number) {
    const p = toScreen(wx, wy - 10);
    const info = abilityFxFor(skill);
    if (info) {
      const s = this.scene.add
        .sprite(p.x, p.y, `fx-${info.sheet}`)
        .setDepth(23)
        .setScale((ABILITY_H / info.h) * ARENA_SCALE);
      s.play(`fx:${info.sheet}`, true);
      s.once("animationcomplete", () => s.destroy());
      this.scene.time.delayedCall(1400, () => s.destroy());
      return;
    }
    const ring = this.scene.add.circle(p.x, p.y, 10, fallback, 0).setDepth(23);
    ring.setStrokeStyle(3, fallback, 1);
    this.scene.tweens.add({
      targets: ring, radius: 36 * ARENA_SCALE, alpha: 0,
      duration: 420, onComplete: () => ring.destroy(),
    });
  }

  /** The procedural fallback, for the elements PAC ships no frames for. */
  private shape(x: number, y: number, colour: number, scale: number) {
    const g = this.scene.add.graphics().setDepth(21);
    const s = 1.2 * ARENA_SCALE * scale;
    g.fillStyle(colour, 0.9);
    g.fillCircle(0, 0, 3 * s);
    g.lineStyle(2, colour, 0.55);
    g.strokeCircle(0, 0, 5.5 * s);
    g.setPosition(x, y);
    return g as unknown as Phaser.GameObjects.GameObject & { x: number; y: number };
  }
}
