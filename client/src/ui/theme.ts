/** Colours, type and the two shapes every screen is built from. */

/** Straight from pokemonAutoChess `app/public/src/style/colors.css`. */
export const C = {
  // Backgrounds: a blue-grey ramp, not greys.
  // Cold ground, warm surfaces. Panels read as objects sitting on a stage
  // rather than rectangles beside it, and the four values are far enough
  // apart in lightness to separate -- they used to sit within 21 points of
  // each other, which is why everything looked like one grey mass.
  bg: 0x1e2432,
  panel: 0x5a5768,
  panelLit: 0x736d84,
  panelDim: 0x3d3a4c,
  edge: 0x141926,
  input: 0x262626,

  text: 0xffffff,
  dim: 0xc3cddf,
  accent: 0x69b7eb,
  gold: 0xffc107,
  green: 0x8ede1d,
  red: 0xf74f4f,

  elixir: 0xc961e8,
  elixirDim: 0x3a2d47,
  player: 0x69b7eb,
  enemy: 0xf74f4f,
  hp: 0x8ede1d,

  // The board keeps its own greens -- it is terrain, not chrome.
  grass: 0x2f6b3a,
  grassAlt: 0x35753f,
  river: 0x2a5c8a,
  bridge: 0x8a6a3f,

  // Damage types, as PAC colours them.
  physical: 0xe76e55,
  special: 0x80b3ff,
  true: 0xf7d51d,
} as const;

/** PAC's rarity ramp, which is more legible than the one we invented. */
const RARITY: Record<string, number> = {
  common: 0xa0a0a0,
  uncommon: 0x3bc95e,
  rare: 0x41bfcc,
  epic: 0x927fff,
  // Lightened from 0xe53b3b, which sat at 1.7:1 against the panel behind it
  // -- a rarity nobody could see. Not caused by the warm surfaces; it was
  // just as invisible on the old ones.
  ultra: 0xff6b5e,
  unique: 0xffffff,
  legendary: 0xe6cb49,
  special: 0xe58ee5,
  hatch: 0xb9915a,
};

export const rarityColor = (rarity: string): number => RARITY[rarity] ?? C.dim;

/** Two families, used for two jobs. */
export const PIXEL = "PokemonClassic";
export const BODY = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * Publish the palette to CSS, so there is one copy of it.
 *
 * The DOM menu and modals kept their own hexes, which meant the canvas and the
 * page could drift apart and nothing would say so -- a theme change moved one
 * and left the other. Called once at boot; `ui.css` reads `var(--bg)` and the
 * rest.
 */
export function publishPalette(root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(C)) {
    if (typeof value === "number") root.style.setProperty(`--${name}`, hex(value));
  }
}

/** A text style. */
export function style(
  size: number,
  color: number = C.text,
  weight: "normal" | "bold" = "normal",
  pixel = false,
): Phaser.Types.GameObjects.Text.TextStyle {
  const s: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: pixel ? `${PIXEL}, ${BODY}` : BODY,
    fontSize: `${size}px`,
    fontStyle: pixel ? "normal" : weight,
    color: hex(color),
    // Render the text canvas at 2x and let it scale down.
    //
    // `pixelArt: true` in the game config turns antialiasing off globally,
    // which is right for a 24px creature and wrong for a word: every glyph was
    // being nearest-neighbour sampled at the arena's fractional scale, so text
    // came out ragged and uneven. Resolution is the per-text escape hatch --
    // the sprites stay crisp and the labels stop looking chewed. One place,
    // because every label in the game goes through here.
    resolution: 2,
  };
  if (pixel) {
    s.shadow = { offsetX: 0, offsetY: 2, color: "#00000060", blur: 0, fill: true };
  }
  return s;
}

/** Shorthand for the pixel face, which most in-game labels want. */
export const px = (size: number, color: number = C.text) => style(size, color, "normal", true);
