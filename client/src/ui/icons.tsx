/**
 * The tab icons.
 *
 * Drawn for this game rather than borrowed. The first attempt pulled from
 * game-icons.net, which is a fantasy RPG library -- swords, armour, satchels.
 * It suits pokemonAutoChess, which is framed that way; it does not suit a
 * Pokemon lane battler, and picking by filename produced a deck that looked
 * like a crate and a pack that looked like body armour.
 *
 * These are 18x16 pixel art in the game's own palette, drawn at 2x so one
 * source pixel is two screen pixels -- a fractional scale would resample the
 * art and soften every edge, which is the mistake that clipped the chest.
 *
 * Each one is a thing that exists in the game: the chest you open, the cards
 * you carry, a poke ball, the Pokedex, the guide.
 */

const NAMES = ["packs", "deck", "battle", "dex", "guide"] as const;

export type IconName = (typeof NAMES)[number];

export function Icon({ name }: { name: IconName }) {
  return <i className={`lr-ico lr-ico-${name}`} aria-hidden="true" />;
}
