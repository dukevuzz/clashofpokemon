/**
 * The card, in the lane, on a canvas.
 *
 * A canvas and not Phaser, deliberately. The guide is a document; pulling the
 * engine into it once cost three megabytes on a page of text and was split out
 * for exactly that reason. Everything here is drawImage against the same atlas
 * the game uses, which is a few hundred bytes of code and no dependency.
 *
 * The timeline lives in `showcase.ts` and is tested there. This file loads two
 * images, asks what should be on screen, and draws it.
 */

import { useEffect, useRef, useState } from "react";
import type { Card } from "../core/cards";
import { SHEETS } from "../data/sheets";
import { STAGE, DOWN, UP, planFor, beatAt, sparringFor } from "./showcase";
import { TYPE_COLORS } from "../core/species";

/*
 * The atlas is packed and trimmed: every frame is [x, y, w, h, offX, offY],
 * cut out of a cell of `cell` size with the transparent margin removed. The
 * offsets are not decoration -- drawing at the frame's own size and ignoring
 * them stacks every creature at the top-left of its cell, and using the cell
 * size as the source rectangle reads a whole block of neighbouring frames,
 * which is exactly what a first draft did.
 */
type Frame = [number, number, number, number, number, number];
type Sheet = { cell: [number, number]; f: Record<string, Frame> };
type Frames = Record<string, Sheet>;

/*
 * Fetched, not imported.
 *
 * Importing `atlas/index.json` put three and a half megabytes of frame tables
 * into the guide's bundle -- for a page of text, to animate one creature at a
 * time. That is the same mistake that made `skillCard.ts` pull Phaser into a
 * document, and it is worse here because the file is data nobody reads.
 *
 * Fetched once and shared, so opening a second card costs nothing, and the
 * page is interactive long before it arrives.
 */
let atlasPromise: Promise<Frames> | undefined;

function atlas(): Promise<Frames> {
  atlasPromise ??= fetch("/atlas/index.json")
    .then((r) => r.json() as Promise<Frames>)
    .catch(() => ({}));
  return atlasPromise;
}

/** Images are fetched once per sheet and kept for the life of the page. */
const cache = new Map<string, HTMLImageElement>();

/** Where the defender stands: the spot the tower used to occupy. */
const FOE_Y = STAGE.height - 46;

function image(src: string): HTMLImageElement {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    cache.set(src, img);
  }
  return img;
}

/**
 * Which frame to draw, and in which direction.
 *
 * Not every sheet carries all eight directions -- Machop has no Attack facing
 * away -- so the direction falls back the same way the game's `resolve` does,
 * to whichever one the sheet does have. A missing direction drew nothing.
 */
function frameName(sheet: string, anim: string, through: number, dir = DOWN): string {
  const rows = SHEETS[sheet]?.anims?.[anim] as
    | Record<string, { frames: number }>
    | undefined;
  if (!rows) return `${anim}-0-0`;
  const d = String(dir) in rows ? String(dir) : Object.keys(rows)[0];
  const count = rows[d]?.frames ?? 1;
  const i = Math.min(count - 1, Math.max(0, Math.floor(through * count)));
  return `${anim}-${d}-${i}`;
}

export function Showcase({ card }: { card: Card }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [frames, setFrames] = useState<Frames>();

  useEffect(() => {
    let alive = true;
    void atlas().then((f) => { if (alive) setFrames(f); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !frames) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sheet = frames[card.sheet];
    const creature = image(`/atlas/${card.sheet}.png`);
    // Who it is walking at: a creature rather than a building, so a drop
    // visibly lands on something and a reach reads as a reach.
    const foeSheet = sparringFor(card);
    const foe = image(`/atlas/${foeSheet}.png`);
    const grass = image("/tiles/ground_grass.png");
    const plan = planFor(card);

    // Pixel art: no smoothing, ever. The whole look depends on it.
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let start = 0;
    let stopped = false;

    // The clock is passed in by requestAnimationFrame, so a backgrounded tab
    // simply stops rather than fast-forwarding when it comes back.
    const draw = (now: number) => {
      if (stopped) return;
      if (!start) start = now;
      const t = (now - start) / 1000;
      const beat = beatAt(card, plan, t);

      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = (w * STAGE.height) / STAGE.width;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const scale = (canvas.width / STAGE.width) / dpr;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, STAGE.width, STAGE.height);

      // Ground, tiled, so the strip reads as a piece of the board rather than
      // a creature floating on the page background.
      if (grass.complete) {
        for (let y = 0; y < STAGE.height; y += 24) {
          for (let x = 0; x < STAGE.width; x += 24) ctx.drawImage(grass, x, y, 24, 24);
        }
      }

      // The defender, looking back up the lane, and flinching when hit.
      const foeEntry = frames[foeSheet];
      if (foe.complete && foeEntry) {
        const anim = beat.hitting && SHEETS[foeSheet]?.anims?.Hurt ? "Hurt" : "Idle";
        const key = frameName(foeSheet, anim, beat.hitting ? 0.5 : (t % 1), UP);
        const at = foeEntry.f[key] ?? foeEntry.f["Idle-0-0"] ?? Object.values(foeEntry.f)[0];
        if (at) {
          const [fx, fy, fw, fh, fox, foy] = at;
          const [fcw, fch] = foeEntry.cell;
          const feetFoe = SHEETS[foeSheet]?.feetOffset ?? 0;
          const cx = STAGE.width / 2 - fcw / 2;
          const cy = FOE_Y - fch / 2 + feetFoe;
          ctx.drawImage(foe, fx, fy, fw, fh, cx + fox, cy + foy, fw, fh);
        }
      }

      // The creature.
      if (creature.complete && sheet) {
        const [cellW, cellH] = sheet.cell;
        const key = frameName(card.sheet, beat.anim, beat.through);
        const at = sheet.f[key] ?? sheet.f["Idle-0-0"] ?? Object.values(sheet.f)[0];
        if (at) {
          const [sx, sy, sw, sh, offX, offY] = at;
          const info = SHEETS[card.sheet];
          const feet = info?.feetOffset ?? 0;
          /*
           * Placed by its cell, and the cell is centred on the creature.
           *
           * Two things at once. The frame is a tight crop and the offsets say
           * where that crop sat inside the cell, so anchoring the crop itself
           * makes a creature jump about as the crop changes shape between
           * frames of one walk.
           *
           * And a PMD cell is centred on the body, not resting on it. Treating
           * the cell bottom as the feet is right for Machop, whose cell is 80
           * tall, and puts Zapdos -- 136 tall -- fifty pixels above the strip
           * with nothing drawn at all. Every legendary was invisible.
           */
          const cellX = STAGE.width / 2 - cellW / 2;
          let cellY = beat.y - cellH / 2 + feet;
          let alpha = 1;

          /*
           * Arriving, for the cards that do not walk in.
           *
           * Drawn the way the game draws it rather than invented here: a drop
           * falls straight down with a shadow that tightens as it lands, a
           * throw is the same arc travelling in from your own half, and a
           * tunnelling card is simply not there until it surfaces -- which is
           * the point of it, since it cannot be hit on the way.
           */
          if (beat.arriving) {
            const { kind, frac } = beat.arriving;
            if (kind === "tunnel") {
              // Underground until near the end, then up. A mound of disturbed
              // earth marks the spot so it is not just an empty strip.
              alpha = frac < 0.72 ? 0 : (frac - 0.72) / 0.28;
              ctx.fillStyle = "rgba(70,52,36,0.55)";
              ctx.beginPath();
              ctx.ellipse(STAGE.width / 2, beat.y - 2, 7 - frac * 2, 3, 0, 0, Math.PI * 2);
              ctx.fill();
            } else {
              // Height above the ground: falling accelerates, so the remaining
              // height is 1 - frac^2 rather than (1 - frac)^2.
              const peak = kind === "throw" ? 30 : 52;
              cellY -= peak * (1 - frac * frac);
              // The shadow is the timer, and starts wide.
              ctx.fillStyle = `rgba(0,0,0,${0.1 + 0.24 * frac})`;
              ctx.beginPath();
              ctx.ellipse(
                STAGE.width / 2, beat.y - 1,
                6 + (1 - frac) * 9, 3 + (1 - frac) * 3, 0, 0, Math.PI * 2,
              );
              ctx.fill();
            }
          }

          /*
           * The impact itself: a ring where it landed.
           *
           * Drawn under the creature so it reads as ground rather than as an
           * effect stuck to the sprite, and sized from the real radius -- 36
           * board units, scaled the same way reach is.
           */
          if (beat.hitting && beat.arriving?.kind === "drop") {
            const r = (36 / 384) * STAGE.width;
            ctx.strokeStyle = "rgba(255,236,170,0.85)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(STAGE.width / 2, beat.y - 2, r, r * 0.42, 0, 0, Math.PI * 2);
            ctx.stroke();
          }

          if (alpha > 0) {
            ctx.globalAlpha = alpha;
            ctx.drawImage(creature, sx, sy, sw, sh, cellX + offX, cellY + offY, sw, sh);
            ctx.globalAlpha = 1;
          }
        }
      }

      /*
       * The shot, for anything that attacks at range.
       *
       * Reported as "Dreepy shoot but no shoot sprite" -- the pose was right
       * and nothing left its hands, which reads as a miss rather than as an
       * attack. Drawn in the card's own type colour: cheap, and it says which
       * type the damage is coming as, which is the thing that decides whether
       * it hurts.
       */
      if (beat.shot !== undefined) {
        const fromY = beat.y - 12;
        const toY = STAGE.height - 22;
        const x = STAGE.width / 2;
        const y = fromY + (toY - fromY) * beat.shot;
        const c = TYPE_COLORS[card.types[0]];
        ctx.fillStyle = c
          ? `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`
          : "#ffd75e";
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        // A short tail, so at 60fps it reads as travelling rather than blinking.
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(x, y - 4, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [card, frames]);

  return (
    <div className="g-showcase">
      <canvas ref={ref} className="g-showcase-canvas" aria-hidden="true" />
      <p className="g-dim g-showcase-note">
        Arriving the way it really arrives, stopping at its own reach, then
        attacking at its own rate and finishing with its skill. All of it is
        the card's real numbers and the animations it plays in a match.
      </p>
    </div>
  );
}
