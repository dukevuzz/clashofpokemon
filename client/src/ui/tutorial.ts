/**
 * The scripted tutorial: what it teaches, in order.
 *
 * Players who found the game on YouTube asked for one, and most of what needs
 * teaching cannot be taught during a real match -- evolution needs the same
 * card three times, Deoxys needs Deoxys in hand, tunnelling needs Diglett. A
 * script controls the deck and the opponent, so every lesson fires.
 *
 * This file is content, not machinery: a list of steps, each with the hand it
 * needs, what to say, and how to know it worked. The scene reads it and does
 * as it is told, which means a badly worded line is fixed here and can be
 * tested without a canvas.
 */

import type { Match } from "../core/match";
import { config } from "../core/config";
import type { Side } from "../core/config";

const DONE_KEY = "clashofpokemon.tutorial";

export interface Lesson {
  id: string;
  /** The line above the board. One sentence. */
  text: string;
  /** The hand for this lesson. Fixed, so what is being taught is always to hand. */
  hand: string[];
  /** Elixir to start the lesson with. Full unless the lesson is about waiting. */
  elixir?: number;
  /** Draw the legal half. Only worth it while placement is the lesson. */
  showZone?: boolean;
  /** Enemies to put on the board when the lesson begins. */
  spawn?: Array<{ card: string; x: number; y: number }>;
  /**
   * Clear the board before this lesson starts.
   *
   * Off by default, and that default matters: the first lesson asks you to
   * place a Charmander and the second asks you to watch it walk, so wiping
   * between them made the creature you had just placed disappear. Only set
   * this where the previous lesson's leftovers would actually get in the way.
   */
  clear?: boolean;
  /** True once the player has done the thing. */
  done(m: Match, seat: Side): boolean;
  /** A second line, shown once done, before moving on. */
  after?: string;
}

const mine = (m: Match, seat: Side) => m.units.filter((u) => u.side === seat && !u.dead);
const theirs = (m: Match, seat: Side) =>
  m.units.filter((u) => u.side !== seat && !u.dead);

/** Anything of mine that is this species, whatever form it took. */
const played = (m: Match, seat: Side, id: string) =>
  mine(m, seat).some((u) => u.card.id === id || u.card.id.startsWith(id));

export const LESSONS: Lesson[] = [
  {
    id: "deploy",
    text: "Drag Charmander onto your half of the board",
    hand: ["charmander"],
    showZone: true,
    done: (m, seat) => mine(m, seat).length > 0,
    after: "That is the whole of playing a card.",
  },
  {
    id: "hands-off",
    text: "It walks and fights on its own — you never steer it",
    hand: ["charmander"],
    // Watch it reach the far side of the river.
    done: (m, seat) => mine(m, seat).some((u) => u.y < config.arenaHeight / 2),
    after: "Everything you play does this. Where you drop it is the decision.",
  },
  {
    id: "defend",
    clear: true,
    text: "One of theirs is coming — drop a card in front of it",
    hand: ["machop"],
    // On the bridge, already across, so it is walking at the player rather
    // than standing in its own half doing nothing.
    spawn: [{ card: "caterpie", x: 80, y: 390 }],
    done: (m, seat) => theirs(m, seat).length === 0,
    after: "Defending is putting something in the way.",
  },
  {
    id: "elixir",
    clear: true,
    text: "Elixir fills on its own — one every 2.5 seconds. Wait, then play Machop.",
    hand: ["machop"],
    elixir: 0,
    done: (m, seat) => played(m, seat, "machop"),
    after: "Spending it all leaves you with nothing to answer with.",
  },
  {
    id: "forms",
    clear: true,
    // "Tap twice", because the first tap selects and the second cycles -- the
    // rule that stops a drag from transforming the card under your thumb.
    text: "Tap Deoxys twice to change its body, then drag it out",
    hand: ["deoxys"],
    // Any body counts. Insisting on a *changed* one would fail the player who
    // decided the one they were looking at was the one they wanted.
    done: (m, seat) => played(m, seat, "deoxys"),
    // Not "same cost". Deoxys is 7 and its three other bodies are priced at 8
    // -- what you pay is the card in your hand, but the bodies are not
    // interchangeable and saying they were was simply wrong.
    after: "One card, four bodies: fast, tough, or hard-hitting.",
  },
  {
    id: "tunnel",
    clear: true,
    text: "Diglett digs from your king tower — drop it anywhere, even next to their tower",
    hand: ["diglett"],
    done: (m, seat) => played(m, seat, "diglett"),
    after: "It cannot be touched while it is underground.",
  },
  {
    id: "drop",
    clear: true,
    text: "Snorlax falls from the sky — watch the shadow before it lands",
    hand: ["snorlax"],
    done: (m, seat) => played(m, seat, "snorlax"),
    after: "Whatever is under it takes the hit — but it is slow, so it can be answered.",
  },
  {
    id: "throw",
    clear: true,
    text: "Voltorb is thrown — it can be placed anywhere, not just your half",
    hand: ["voltorb"],
    done: (m, seat) => played(m, seat, "voltorb"),
    after: "Thrown and tunnelling cards ignore the halfway line. Nothing else does.",
  },
  {
    id: "evolve",
    clear: true,
    text: "Play Charmander twice more — cards evolve when you keep using them",
    hand: ["charmander"],
    done: (m, seat) => played(m, seat, "charmeleon"),
    after: "Charmeleon replaces Charmander in your deck for the rest of the match.",
  },
];

/** Where the tutorial's enemy stands, so a lesson can put something in the lane. */
export const ENEMY_SIDE: Side = config.ENEMY;

export const finished = (): boolean => {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
};

export const markFinished = () => {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Storage refused: the tutorial is offered again, which is harmless.
  }
};
