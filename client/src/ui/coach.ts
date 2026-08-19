/**
 * What to say to somebody playing their first match.
 *
 * Not a tutorial level. Players asked for a tutorial after watching the game
 * on YouTube, and the answer is not a second game to build and maintain -- it
 * is the real match, with a sentence appearing at the moment each rule starts
 * to matter and going away once they have done the thing.
 *
 * Every step is: a trigger read off the live match, a line, and a way to be
 * finished with it. They fire in order, one at a time, and the whole sequence
 * runs once ever.
 *
 * The rules live here rather than in the scene because they are content, not
 * rendering: this file is the thing to edit when a line reads badly, and it
 * can be tested without a canvas.
 */

import type { Match } from "../core/match";
import { config } from "../core/config";

const SEEN_KEY = "clashofpokemon.coached";

export interface Step {
  id: string;
  /** What to say. One sentence -- anything longer is not read mid-match. */
  text: string;
  /** Should this be showing now? */
  when(m: Match, seat: 1 | 2): boolean;
  /** Has the player done it? Once true, the step never returns. */
  done(m: Match, seat: 1 | 2): boolean;
  /** Draw the legal half while this is up. Only the first step needs it. */
  showZone?: boolean;
}

const other = (seat: 1 | 2): 1 | 2 => (seat === 1 ? 2 : 1);

/** Anything of mine that is on the board and finished arriving. */
const mine = (m: Match, seat: 1 | 2) =>
  m.units.filter((u) => u.side === seat && !u.dead);

export const STEPS: Step[] = [
  {
    id: "deploy",
    text: "Drag a Pokémon onto your half of the board",
    showZone: true,
    when: (m, seat) => mine(m, seat).length === 0,
    done: (m, seat) => mine(m, seat).length > 0,
  },
  {
    id: "hands-off",
    text: "It walks and fights on its own — you cannot steer it",
    when: (m, seat) => mine(m, seat).length > 0,
    // Long enough to read, and it goes when they play their next card.
    done: (m, seat) => mine(m, seat).length > 1 || m.time < config.matchSeconds - 25,
  },
  {
    id: "elixir",
    text: "Your elixir is full — spend it, it stops filling at 10",
    when: (m, seat) => m.elixir[seat] >= config.elixirMax - 0.05,
    done: (m, seat) => m.elixir[seat] < config.elixirMax - 1,
  },
  {
    id: "defend",
    text: "Something is coming — drop a card in its path to stop it",
    when: (m, seat) => {
      // Theirs, past the river, on my side of the board.
      const half = config.arenaHeight / 2;
      return m.units.some((u) => {
        if (u.side !== other(seat) || u.dead) return false;
        return seat === config.PLAYER ? u.y > half : u.y < half;
      });
    },
    done: (m, seat) => {
      const half = config.arenaHeight / 2;
      return !m.units.some((u) => {
        if (u.side !== other(seat) || u.dead) return false;
        return seat === config.PLAYER ? u.y > half : u.y < half;
      });
    },
  },
  {
    id: "lane-open",
    text: "You broke a tower — you can deploy further up that lane now",
    when: (m, seat) =>
      m.towers.some((t) => t.side === other(seat) && t.kind === "side" && t.dead),
    done: (m) => m.time < 60,
  },
  {
    id: "double",
    text: "Double elixir. Most matches are decided in this last minute.",
    when: (m) => m.time <= config.suddenDeathAt,
    done: (m) => m.time < config.suddenDeathAt - 12,
  },
];

/**
 * Which line to show, if any.
 *
 * Steps are offered in order and each is retired for good once done, so a
 * player who never lets their elixir cap simply never sees that line -- and
 * one who has already learned to defend is not told about it later.
 */
export function nextStep(m: Match, seat: 1 | 2, retired: Set<string>): Step | undefined {
  for (const step of STEPS) {
    if (retired.has(step.id)) continue;
    if (step.done(m, seat)) {
      // Already true before it was ever shown: nothing to teach.
      retired.add(step.id);
      continue;
    }
    if (step.when(m, seat)) return step;
  }
  return undefined;
}

/** Has this browser been coached already? */
export const coached = (): boolean => {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

export const markCoached = () => {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // A browser that refuses storage gets coached every time, which is a far
    // better failure than not being able to play.
  }
};
