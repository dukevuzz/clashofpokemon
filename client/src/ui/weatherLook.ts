/**
 * What each sky looks like, as plain data.
 *
 * Split from `weatherFx.ts` so it can be tested without Phaser. The rules of
 * weather live in `core/weather.ts` and already reach damage in both engines;
 * this file only decides how a player gets to *see* them. The brief it follows
 * is the one on the mock: tint plus particles, nothing else.
 */

import { BOOSTS, WEATHER_SWING, type Weather } from "../core/weather";

/** The small textures a weather is drawn with. All generated in code. */
export type Speck = "streak" | "flake" | "mote" | "puff" | "wisp";

export interface Particles {
  kind: Speck;
  /** Colour the speck is tinted. */
  tint: number;
  /** Milliseconds between emissions; smaller is denser. */
  every: number;
  /** Pixels per second, as a range. Positive y falls, negative rises. */
  speedX: [number, number];
  speedY: [number, number];
  /** How long one speck lives, in milliseconds. */
  life: number;
  alpha: number;
  scale: number;
}

export interface Look {
  /** Colour washed over the whole board. */
  tint: number;
  /** How strongly. Capped well short of hiding the fight. */
  alpha: number;
  /** Nothing for a sky that is only a colour. */
  particle?: Particles;
  /** What the caption calls it. */
  name: string;
}

// Rain and sandstorm take their tints from Pokemon Auto Chess's weather
// manager; the rest are chosen to read as their type at a glance.
export const LOOK: Readonly<Record<Weather, Look>> = {
  RAIN: {
    name: "Rain", tint: 0x296383, alpha: 0.3,
    particle: { kind: "streak", tint: 0xdcecff, every: 4, speedX: [-70, -50],
                speedY: [680, 820], life: 900, alpha: 0.8, scale: 1.1 },
  },
  STORM: {
    name: "Storm", tint: 0x1d2a4a, alpha: 0.36,
    particle: { kind: "streak", tint: 0xeef5ff, every: 3, speedX: [-140, -110],
                speedY: [820, 960], life: 800, alpha: 0.85, scale: 1.3 },
  },
  SNOW: {
    name: "Snow", tint: 0xcfe8ff, alpha: 0.16,
    particle: { kind: "flake", tint: 0xffffff, every: 22, speedX: [-18, 18],
                speedY: [40, 70], life: 9000, alpha: 0.95, scale: 1 },
  },
  SANDSTORM: {
    name: "Sandstorm", tint: 0x9a791a, alpha: 0.3,
    particle: { kind: "streak", tint: 0xf0d48a, every: 4, speedX: [560, 720],
                speedY: [70, 130], life: 900, alpha: 0.75, scale: 1 },
  },
  DROUGHT: {
    name: "Drought", tint: 0xff9a3c, alpha: 0.16,
    particle: { kind: "mote", tint: 0xffe2a0, every: 90, speedX: [-8, 8],
                speedY: [-45, -25], life: 5000, alpha: 0.7, scale: 1 },
  },
  ZENITH: {
    name: "Zenith", tint: 0xfff3a0, alpha: 0.14,
    particle: { kind: "mote", tint: 0xfffbe0, every: 120, speedX: [-6, 6],
                speedY: [-30, -15], life: 6000, alpha: 0.8, scale: 1.2 },
  },
  WINDY: {
    name: "Windy", tint: 0xd8e4f0, alpha: 0.08,
    particle: { kind: "wisp", tint: 0xffffff, every: 70, speedX: [380, 520],
                speedY: [-10, 10], life: 1400, alpha: 0.45, scale: 1 },
  },
  NIGHT: {
    // Tint alone, as on the mock. Particles would read as rain.
    name: "Night", tint: 0x0b1030, alpha: 0.38,
  },
  MISTY: {
    name: "Misty", tint: 0xf7c6e0, alpha: 0.18,
    particle: { kind: "puff", tint: 0xffe3f1, every: 220, speedX: [-12, 12],
                speedY: [-8, 8], life: 7000, alpha: 0.35, scale: 1.6 },
  },
  SMOG: {
    name: "Smog", tint: 0x6b3f7a, alpha: 0.24,
    particle: { kind: "puff", tint: 0xb993c8, every: 200, speedX: [-10, 10],
                speedY: [-10, 4], life: 7000, alpha: 0.3, scale: 1.8 },
  },
  MURKY: {
    name: "Murky", tint: 0x2a1f3d, alpha: 0.32,
    particle: { kind: "puff", tint: 0x6e5a8e, every: 240, speedX: [-8, 8],
                speedY: [-6, 6], life: 8000, alpha: 0.35, scale: 2 },
  },
};

const titled = (type: string) => type.charAt(0) + type.slice(1).toLowerCase();

/**
 * What a player reads when the sky changes: "Rain · Water +20% · Fire −17%".
 *
 * Both numbers come from `WEATHER_SWING`. The damp is its reciprocal, so the
 * two are not the same size, and writing "20%" by hand in both places is how
 * that was once got wrong.
 */
export function caption(weather: Weather | null): string {
  if (!weather) return "";
  const { up, down } = BOOSTS[weather];
  const gain = Math.round((WEATHER_SWING - 1) * 100);
  const loss = Math.round((1 - 1 / WEATHER_SWING) * 100);
  return `${LOOK[weather].name} · ${titled(up)} +${gain}% · ${titled(down)} −${loss}%`;
}
