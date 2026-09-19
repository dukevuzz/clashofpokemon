/**
 * What the sky is doing, read off the deck that was brought.
 *
 * Nobody picks the weather from a menu. Play four Fire cards and the arena
 * goes into drought -- the deck said so. That is the whole design: a rule the
 * player expresses by deckbuilding rather than by choosing.
 *
 * Pure, and deliberately so. This module decides *what* the weather is; it
 * knows nothing about drawing it and nothing about Phaser, so the visual pass
 * and any later stat effects can be built against the same answer.
 */

export type Weather =
  | "DROUGHT" | "RAIN" | "SNOW" | "STORM" | "WINDY" | "SANDSTORM"
  | "ZENITH" | "NIGHT" | "MISTY" | "SMOG" | "MURKY";

/**
 * Taken from Pokemon Auto Chess (`app/types/enum/Weather.ts`), which is the
 * closest thing to a canon mapping this genre has.
 *
 * Two of its thirteen entries are deliberately absent. `WILD -> BLOODMOON`
 * has no home because we have no WILD type. `NORMAL -> NEUTRAL` is dropped
 * because a neutral sky is the absence of weather, not a kind of it -- giving
 * it a name would put an effect in the UI that does nothing.
 *
 * Six of our types are therefore unmapped: BUG, DRAGON, FIGHTING, PSYCHIC,
 * ROCK and STEEL. A deck built on those cannot turn the sky on at all. That is
 * a real gap and an open design question, not an oversight -- see
 * `docs/plans/weather-and-terrain.md`.
 */
export const WEATHER_BY_TYPE: Readonly<Record<string, Weather>> = {
  FIRE: "DROUGHT",
  WATER: "RAIN",
  ICE: "SNOW",
  ELECTRIC: "STORM",
  FLYING: "WINDY",
  GROUND: "SANDSTORM",
  GRASS: "ZENITH",
  DARK: "NIGHT",
  FAIRY: "MISTY",
  POISON: "SMOG",
  GHOST: "MURKY",
};

/**
 * How many cards of a type it takes to claim the sky.
 *
 * PAC uses 8, sized for an auto-chess board that holds far more than a hand.
 * Rescaled to 4 -- two thirds of a six-card deck, so weather is a commitment
 * rather than an accident.
 */
export const WEATHER_THRESHOLD = 4;

/** Only the types matter here, so this is all a caller has to supply. */
export interface Typed {
  readonly types: readonly string[];
}

/**
 * The weather a deck brings, or null for none.
 *
 * A tie produces no weather. That single rule is what keeps the sky from
 * flickering: without it, two types level with each other hand the sky back
 * and forth on every recount.
 */
export function weatherFor(deck: readonly Typed[]): Weather | null {
  const count = new Map<Weather, number>();
  for (const card of deck) {
    // A dual-type card argues for both of its skies.
    for (const type of new Set(card.types)) {
      const weather = WEATHER_BY_TYPE[type];
      if (weather) count.set(weather, (count.get(weather) ?? 0) + 1);
    }
  }

  let best: Weather | null = null;
  let top = 0;
  let tied = false;
  for (const [weather, n] of count) {
    if (n > top) { top = n; best = weather; tied = false; }
    else if (n === top) { tied = true; }
  }

  return !tied && top >= WEATHER_THRESHOLD ? best : null;
}

// --------------------------------------------------------------- the effect
//
// Weather in Pokemon is not a filter over the screen, it is a rule: rain
// powers Water and quenches Fire, sun does the reverse, a sandstorm favours
// the things that do not mind sand. A sky that only changed the colours would
// be missing the entire point of the mechanic.
//
// Four of these are canon and need no defending. The other seven are Pokemon
// Auto Chess's inventions with no games behind them, so each is given the
// same shape: **it boosts the type that summoned it, and damps that type's
// canonical answer.** That rule is what makes the pairing guessable without a
// tooltip -- rain beats fire because water beats fire, not because a table
// somewhere says so.

/** Every weather a deck can produce, in a fixed order for tests and UI. */
export const ALL_WEATHER: readonly Weather[] = [
  "DROUGHT", "RAIN", "SNOW", "STORM", "WINDY",
  "SANDSTORM", "ZENITH", "NIGHT", "MISTY", "SMOG", "MURKY",
];

/** Which type each weather favours, and which it holds back. */
export const BOOSTS: Readonly<Record<Weather, { up: string; down: string }>> = {
  // Canon.
  DROUGHT:   { up: "FIRE",     down: "WATER" },
  RAIN:      { up: "WATER",    down: "FIRE" },
  SNOW:      { up: "ICE",      down: "GRASS" },
  SANDSTORM: { up: "GROUND",   down: "FLYING" },
  // Invented, but each follows the same rule: the summoning type over the
  // type that answers it on the chart.
  STORM:     { up: "ELECTRIC", down: "WATER" },
  WINDY:     { up: "FLYING",   down: "BUG" },
  ZENITH:    { up: "GRASS",    down: "ROCK" },
  NIGHT:     { up: "DARK",     down: "PSYCHIC" },
  MISTY:     { up: "FAIRY",    down: "DRAGON" },
  SMOG:      { up: "POISON",   down: "FAIRY" },
  MURKY:     { up: "GHOST",    down: "NORMAL" },
};

/**
 * How far weather may tilt a hit.
 *
 * Deliberately small. The type chart already reaches 4x on a double weakness,
 * and stacking a canon-sized 1.5x on top of that would let a matchup decide a
 * match before either player has made a decision. Clash Royale's most
 * criticised feature is a per-level multiplier that compounds; this one is
 * flat, symmetric, and visible to both players from the moment the sky
 * changes.
 *
 * A starting hypothesis, not a settled number -- tune it on the headless
 * simulator, which is how the tower-damage and deck-size problems were found.
 */
export const WEATHER_SWING = 1.2;

/**
 * What the weather does to a hit from a creature of these types.
 *
 * The damp is the exact reciprocal of the boost, so what a weather grants one
 * type it takes from the other and the total damage in a match does not
 * quietly inflate. A card that is both the favoured and the held-back type
 * takes the boost: being on the right side of the weather at all is enough.
 */
export function weatherBoost(weather: Weather | null, types: readonly string[]): number {
  if (!weather) return 1;
  const { up, down } = BOOSTS[weather];
  if (types.includes(up)) return WEATHER_SWING;
  if (types.includes(down)) return 1 / WEATHER_SWING;
  return 1;
}

/**
 * The one sky both players are under, read from both decks at once.
 *
 * There is a single arena, so there is a single answer, and it cannot depend
 * on which seat is asking -- a replay and a spectator have no seat at all.
 * Counting the decks together is also what gives the mechanic counterplay:
 * four Fire answered by four Water is a tie, and a tie is no weather, so
 * committing hard to a type can be denied by committing to the type that
 * opposes it.
 */
export function weatherForMatch(one: readonly Typed[], two: readonly Typed[]): Weather | null {
  return weatherFor([...one, ...two]);
}
