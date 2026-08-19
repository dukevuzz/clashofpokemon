/** The one fixture that says the Java port is the same game. */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Match } from "../src/core/match.js";
import { deploy } from "../src/core/deploy.js";
import { byId, ALL } from "../src/core/cards.js";
import { config, type Side } from "../src/core/config.js";
import { costOf } from "../src/core/hand.js";

const OUT = "../../server/src/test/resources/differential.json";

/** The generator both engines run. Ported verbatim; see MulberryTest in Java. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every card a deck may hold, split across matches until all of them have played. */
const ROSTER = ALL.map((c) => c.id);
const PER_SIDE = config.deckSize;
const PER_MATCH = PER_SIDE * 2;

/** Decks that between them deal every card at least once. */
function coveringDecks(): Array<[string[], string[]]> {
  const out: Array<[string[], string[]]> = [];
  for (let at = 0; at < ROSTER.length; at += PER_MATCH) {
    // Wraps at the end rather than leaving a short deck: a match with five
    // cards is a different game, and this is not the place to test that.
    const slice = Array.from({ length: PER_MATCH },
      (_, i) => ROSTER[(at + i) % ROSTER.length]);
    out.push([slice.slice(0, PER_SIDE), slice.slice(PER_SIDE)]);
  }
  return out;
}

/** And some drawn at random, so cards that never share a deck sometimes do. */
function randomDecks(rng: () => number): [string[], string[]] {
  const pool = [...ROSTER];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [pool.slice(0, PER_SIDE), pool.slice(PER_SIDE, PER_MATCH)];
}

interface Play {
  /** The frame this play landed on, not the second. */
  step: number;
  at: number; side: Side; slot: number; x: number; y: number;
  allowed?: boolean;
  spent?: number;
  handAfter?: Array<string | null>;
  deckAfter?: string[];
  drawIndexAfter?: number;
  handBefore?: Array<string | null>;
  said?: string[];
}

/** When to try, and where. */
interface Attempt { at: number; slot: number; side: Side; x: number; y: number }

function attempts(rng: () => number, sweep: boolean): Attempt[] {
  const out: Attempt[] = [];
  let n = 0;
  for (let at = 3; at < config.matchSeconds - 4; at += 2 + rng() * 2.5) {
    // The covering matches walk the slots in turn and alternate sides, which
    // is what makes "every card is played" true rather than likely: a random
    // slot leaves whichever card is sitting in the unlucky one untested, and
    // that was twelve of them.
    const side = (sweep ? (n % 2) + 1 : rng() < 0.5 ? 1 : 2) as Side;
    const slot = sweep ? Math.floor(n / 2) % config.handSize
      : Math.floor(rng() * config.handSize);
    n++;
    out.push({
      at: Math.round(at * 100) / 100,
      side,
      slot,
      x: Math.round((20 + rng() * (config.arenaWidth - 40)) * 100) / 100,
      y: Math.round((20 + rng() * (config.arenaHeight - 40)) * 100) / 100,
    });
  }
  return out;
}

/** Give up on an attempt that has waited this long, and move on. */
const PATIENCE = 25;

const round = (n: number) => Math.round(n * 1000) / 1000;

const cardsOf = (ids: string[]) => ids.map((id) => {
  const c = byId(id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
});

function run(seed: number, deckOne: string[], deckTwo: string[], sweep = false) {
  const match = new Match({
    rng: mulberry32(seed),
    playerDeck: cardsOf(deckOne),
    enemyDeck: cardsOf(deckTwo),
    shuffle: false,   // the deal is not what is under test; the rules are
    bot: {},          // nobody plays itself -- the script plays both sides
  });

  // A separate stream, so drawing the script does not shift the match's own
  // draws -- the seed then names the plays and the shuffles independently.
  const all = attempts(mulberry32(seed ^ 0x5eed), sweep);
  const queuedOne = all.filter((a) => a.side === 1);
  const queuedTwo = all.filter((a) => a.side === 2);
  let nextOne = 0;
  let nextTwo = 0;
  const plays: Play[] = [];
  const checkpoints: unknown[] = [];
  let hits: Array<[number, number]> = [];

  for (let step = 0; step < config.matchSeconds * 30 + 60 && !match.over; step++) {
    // One queue per side, because they wait independently.
    for (const side of [1, 2] as Side[]) {
      const at = side === 1 ? nextOne : nextTwo;
      const queue = side === 1 ? queuedOne : queuedTwo;
      if (at >= queue.length || queue[at].at > match.elapsed) continue;

      const a = queue[at];
      const held = match.hand[side][a.slot];
      const affordable = held && match.elixir[side] >= costOf(match, side, held);
      // Wait for the card rather than spending the attempt on it -- unless it
      // has been waited on long enough that something is clearly wrong.
      if (!affordable && match.elapsed - a.at < PATIENCE) continue;
      if (side === 1) nextOne++; else nextTwo++;

      const p: Play = { step, at: round(match.elapsed), side, slot: a.slot,
        x: a.x, y: a.y };
      plays.push(p);
      p.handBefore = match.hand[side].map((c) => c?.id ?? null);

      const said = match.events.length;
      const before = match.elixir[side];
      // Elixir is not topped up: a play the rules refuse must be refused in
      // both engines, and that agreement is part of what is being checked.
      p.allowed = deploy(match, side, p.slot, p.x, p.y);
      p.spent = round(before - match.elixir[side]);
      p.handAfter = match.hand[side].map((c) => c?.id ?? null);
      p.said = match.events.slice(said).map((e) =>
        e.type === "evolve" ? `evolve:${e.from.id}->${e.to.id}`
        : e.type === "spawn" ? `spawn:${e.unit.card.id}`
        : e.type);
      p.deckAfter = match.deck[side].map((c) => c.id);
      p.drawIndexAfter = match.drawIndex[side];
    }

    // Every hit, kept until the next checkpoint.
    for (const e of match.update(1 / 30)) {
      if (e.type === "hit") hits.push([e.target.id, Math.round(e.amount)]);
      else if (e.type === "cast") hits.push([e.unit.id, -1]);
    }

    if (step % 90 === 0) {
      checkpoints.push({
        step,
        time: round(match.elapsed),
        elixir: [round(match.elixir[1]), round(match.elixir[2])],
        // What is in hand, because a divergence in the rules usually shows up
        // first as a card rather than as a number: an evolution that replaced
        // a slot in one engine and not the other is invisible in elixir until
        // that slot is played, a minute later, at the wrong cost.
        hand: [1, 2].map((side) => match.hand[side as Side].map((c) => c?.id ?? null)),
        towerHP: match.towers.map((t) => Math.round(t.hp)),
        // `[id, card, hp, x, y]` rather than named fields: the same numbers,
        // and a fixture covering the whole roster has to fit in a repository.
        units: [...match.units]
          .sort((a, b) => a.id - b.id)
          .map((u) => [u.id, u.card.id, u.hp, u.x, u.y]),
        // Who has a shot in the air.
        //
        // A projectile whose flight differs in the last bit of a square root
        // lands a frame apart in the two engines, so a creature it is aimed
        // at can legitimately be one hit apart at the instant a checkpoint is
        // taken -- and be identical again a frame later. Everyone else is
        // compared exactly; naming these is what keeps that possible.
        inFlight: [...new Set(match.projectiles.map((p) => p.target.id))],
        hits,
      });
      hits = [];
    }
  }

  return {
    seed,
    deckOne,
    deckTwo,
    over: match.over ?? null,
    plays,
    checkpoints,
    finalTowerHP: match.towers.map((t) => Math.round(t.hp)),
  };
}

const matches: ReturnType<typeof run>[] = [];

/** Every card that has actually stood on the board so far. */
const played = new Set<string>();
function record(m: ReturnType<typeof run>) {
  matches.push(m);
  for (const c of m.checkpoints as Array<{ units: unknown[][] }>) {
    for (const u of c.units) played.add(u[1] as string);
  }
}

// Every card, dealt at least once.
coveringDecks().forEach(([one, two], i) => record(run(1000 + i, one, two, true)));

// And again for whatever did not make it.
for (let round = 0; round < 6; round++) {
  const missing = ROSTER.filter((id) => !played.has(id));
  if (!missing.length) break;

  for (let at = 0; at < missing.length; at += PER_MATCH) {
    // Padded from the front of the roster when the tail is short: a match
    // with four cards is a different game and not the one under test.
    const slice = Array.from({ length: PER_MATCH },
      (_, i) => missing[at + i] ?? ROSTER[i % ROSTER.length]);
    record(run(3000 + round * 100 + at, slice.slice(0, PER_SIDE), slice.slice(PER_SIDE), true));
  }
}

// Then some shuffled together, for pairings the partition never makes.
for (let i = 0; i < 8; i++) {
  const [one, two] = randomDecks(mulberry32(7000 + i));
  record(run(7000 + i, one, two));
}

const out = { matches };
const never = ROSTER.filter((id) => !played.has(id));

const path = new URL(OUT, import.meta.url);
mkdirSync(dirname(path.pathname), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");

console.log("differential.json");
console.log(`  ${matches.length} matches, decks of ${config.deckSize}`);
console.log(`  ${played.size} distinct cards reached the board`);
console.log(`  ${ROSTER.length - never.length} of ${ROSTER.length} deckable cards played`);
if (never.length) console.log(`  never played: ${never.join(", ")}`);
