/** The design space, and how world coordinates map into it. */

import { config, type Side } from "../core/config";

/** The size every scene lays out against. */
export const DESIGN_W = 620;
export const DESIGN_H = 1080;

// ------------------------------------------------------------- the budget
//
// Top to bottom: clock, arena, elixir pips, hand, margin. Each is derived from
// the one below it rather than picked, because picking them is how the first
// attempt put the board through the hand -- the arena ran to y=1004 while the
// cards started at 948, and the cards themselves ended 18px past the bottom of
// the design space.

const HUD_TOP = 76;
export const CARD_W = 118;
export const CARD_H = 150;
const BOTTOM_MARGIN = 16;

export const HAND_Y = DESIGN_H - BOTTOM_MARGIN - CARD_H;
export const PIP_Y = HAND_Y - 24;

export const ARENA_Y = HUD_TOP;
/** Whatever height is left between the clock and the pips. */
export const ARENA_SCALE = (PIP_Y - 18 - ARENA_Y) / config.arenaHeight;
export const ARENA_X = (DESIGN_W - config.arenaWidth * ARENA_SCALE) / 2;

/** How much to scale a creature's sprite. */
export const SPRITE_SCALE = (config.unitSize / config.referenceBody) * ARENA_SCALE;

/** A footprint, in design pixels -- what one creature occupies on screen. */
export const FOOTPRINT = config.unitSize * ARENA_SCALE;

/** Which seat is watching, and therefore which end of the board is "down here". */
let viewSide: Side = config.PLAYER;

/** Set once when a match starts, from the seat the server dealt. */
export function setViewSide(side: Side) {
  viewSide = side;
}

export const viewingFrom = (): Side => viewSide;

/** True when the board has to be turned around to put this seat at the bottom. */
const flipped = () => viewSide !== config.PLAYER;

/** Design-space position of a world point. */
export function toScreen(x: number, y: number): { x: number; y: number } {
  if (flipped()) {
    x = config.arenaWidth - x;
    y = config.arenaHeight - y;
  }
  return { x: ARENA_X + x * ARENA_SCALE, y: ARENA_Y + y * ARENA_SCALE };
}

/** World position of a design-space point -- the inverse, for input. */
export function toWorld(x: number, y: number): { x: number; y: number } {
  const wx = (x - ARENA_X) / ARENA_SCALE;
  const wy = (y - ARENA_Y) / ARENA_SCALE;
  return flipped()
    ? { x: config.arenaWidth - wx, y: config.arenaHeight - wy }
    : { x: wx, y: wy };
}

/** A PMD facing, as seen from this seat. */
export function viewFacing(facing: number): number {
  return flipped() ? (facing + 4) % 8 : facing;
}
