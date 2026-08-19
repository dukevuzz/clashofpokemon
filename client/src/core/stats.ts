/** A creature's numbers, derived from the species rather than authored. */

import { SHEETS } from "../data/sheets";

/** How long a card takes to get going after it lands. */
const DEPLOY_MIN = 0.5;
const DEPLOY_MAX = 2.0;
/** Below this share of the size range, a creature simply arrives. */
const DEPLOY_FREE_BELOW = 0.25;
const BODY_MIN = 190;
const BODY_MAX = 1900;

/** Body area, from the sprite where there is one and from health where not. */
function bodyArea(name: string, hp: number): number {
  const sheet = SHEETS[name];
  return sheet
    ? sheet.bodyWidth * sheet.bodyHeight
    : BODY_MIN + (BODY_MAX - BODY_MIN) * Math.min(1, hp / 300);
}

/** How hard a creature is to push, on a 0.5 to 2 scale around 1. */
export function massFor(name: string, hp: number): number {
  const t = Math.max(0, Math.min(1,
    (bodyArea(name, hp) - BODY_MIN) / (BODY_MAX - BODY_MIN)));
  return Number((0.5 + 1.5 * Math.sqrt(t)).toFixed(2));
}

export function deployDelayFor(name: string, hp: number): number {
  const t = Math.max(0, Math.min(1,
    (bodyArea(name, hp) - BODY_MIN) / (BODY_MAX - BODY_MIN)));
  // Small things arrive. Only a body worth waiting for makes you wait.
  if (t <= DEPLOY_FREE_BELOW) return DEPLOY_MIN;
  const over = (t - DEPLOY_FREE_BELOW) / (1 - DEPLOY_FREE_BELOW);
  return Number((DEPLOY_MIN + (DEPLOY_MAX - DEPLOY_MIN) * over * over).toFixed(2));
}

/** How stats become world numbers. Damage scales with health so ratios hold. */
export const HP_SCALE = 2.6;
export const DAMAGE_SCALE = 4.2;
/** 0.30, down from 0.62. */
export const SPEED_SCALE = 0.30;

/** How fast a creature swings, from the same stat that decides how fast it walks. */
const REFERENCE_SPEED = 50;
export const REFERENCE_RATE = 1.1;
const RATE_EXPONENT = 0.85;
const RATE_FLOOR = 0.45;
const RATE_CEILING = 1.9;

export function attackRateFor(speed: number): number {
  const s = Math.max(1, speed);
  const rate = REFERENCE_RATE * Math.pow(REFERENCE_SPEED / s, RATE_EXPONENT);
  return Math.round(Math.min(RATE_CEILING, Math.max(RATE_FLOOR, rate)) * 100) / 100;
}

