# Raid mode — drop a squad on someone's base

Status: **design sketch, nothing built.** Opened 2026-09-06 from Duc's idea:
*"massive drop out with bigger map and lead pokemon to attack build things"*.

## Why this is the strongest idea on the board

It attacks the actual bottleneck. Every ranked item so far makes a match better
for people already playing; this one **removes the need for two people to be
online at the same time.**

You attack a *snapshot* of someone's base. They were asleep. They see the result
later. Nobody waited in a queue. With a handful of players that is the difference
between a game you can play and a game you can't.

A background research pass over the PMD asset set reached the same conclusion
independently, ranking async base-building **best fit of four** — explicitly
because it needs no concurrent population and no always-on server — and battle
royale **worst** (only 21% of species have a death animation, and it needs a live
crowd).

Two things arriving at the same answer from opposite directions is worth
weighting.

## How it compounds with replays

**An async raid is a replay.** The attacker plays live; the defender watches a
recording. That is exactly the mechanism in `replays.md`, which is already proven
to reproduce a match from `seed + plays` in **549 gzipped bytes**.

So the defender's "someone raided you" view is not new work — it is the replay
player pointed at a raid. Build replays first and half of this is done. Build
this first and you build replays anyway, worse.

## What already exists

| Piece | State |
|---|---|
| Deterministic engine | done, and proven across two languages |
| Recording format | done — `differential.json` is a replay format |
| Units that attack structures | done — towers are structures with no typing |
| Building-only targeting | done — `targets: ["building"]`, Yamper uses it today |
| Rooted (immobile) units | **type exists, no card uses it** — `rooted?: boolean` in `roster.ts` |
| Tower art | 5 sprites: king, side, ruin, per side |
| Scenery for a bigger map | method solved, see `map-scenery.md` |

## The three real problems

### 1. Pathing — the big one

`movement.ts` has no pathfinder, deliberately. Units walk forward, drift to a
lane centre, cross at a bridge. That decision has survived every rewrite and is
why the rules port cleanly to Java.

A Clash of Clans base has **no lanes**. Units pick the nearest building and path
around walls. That is a genuine navmesh problem, and it is the single largest
piece of work in this mode.

Three ways out, cheapest first:

- **No walls.** Units walk straight at the nearest structure. Keeps the "no
  pathfinder" property intact. Loses base-layout depth, which is most of what
  makes CoC interesting.
- **Walls that are just buildings.** A wall is a structure with high HP and no
  attack. Units already stop and hit what blocks them, so a wall is *chewed
  through* rather than walked around. No pathfinding, real layout decisions,
  and it changes the question from "route" to "where do I breach". **This is the
  one I would build.**
- **A real flow field.** Correct, and expensive — and it must be ported to Java
  and agree blow for blow with the TypeScript, which roughly doubles it.

### 2. Building art does not exist

We have towers and nothing else. A base needs resource generators, defences,
storage, a town hall equivalent, and **destruction states** — which are what sell
a raid.

This is the licence problem again, and the standing rule applies: *nothing enters
the repo unless its licence is a named public licence with a version number.*
Three packs have already been rejected on that basis.

**But there may be an answer already on disk.** The DTEF corpus includes
`BuriedRelic`, `SealedRuin`, `DarknightRelic`, `ConcealedRuins`, `JoyousTower`,
`SkyTower` — brickwork, pillars, ruined structures, at the right 24px scale and
in the right art style, under the licence we already ship. Worth an hour of
looking before commissioning anything.

### 3. Bigger map breaks the layout

The arena is 384×672 sized so a phone shows all of it. A base you scroll around
is a different input model — pinch, pan, and placement relative to a camera. The
UI work is not trivial and none of it exists.

## What a raid would be

A sketch, not a spec:

- Your base is a **grid of structures you place**, persisted per account. The
  `deck` table is already keyed `(account, slot)`; a base is the same shape.
- An attacker gets a **squad, not a hand** — no elixir bar, no card cycle.
  Pick N creatures, drop them where you like, watch. That is the "massive drop"
  and it is a genuinely different feel from the lane game.
- Scoring on **percentage destroyed**, which is CoC's, and it works because it
  makes a failed raid still legible.
- The defender sees a replay.

**The thing to protect:** this must not become a second game that needs its own
balance pass, its own roster and its own engine. It shares the creatures, the
type chart, the stats and the combat resolution, or it is not worth starting.

## Honest risk

This is the biggest thing on the board by some distance — bigger than everything
else on it combined. Pathing, art and a new input model are three real projects.

The mitigation is order: **replays first.** They are cheap now, they are ranked
first anyway, and they are load-bearing for this. If raids never get built the
replay work still stands on its own; if they do, half the plumbing is already
there.

Related: [[replays]] · [[map-scenery]]
