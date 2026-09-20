# Weather and terrain

Status: **core built** (`client/src/core/weather.ts`, 10 tests green).
Visual pass not started. One open design problem (see "The unsolved part").
Last touched 2026-08-31. Mockups: `~/Downloads/weathermock.png`, `~/Downloads/terrainmock.png`
(five panels each, outside the repo).

## The idea in one line

Your deck composition sets the sky. Play four Fire cards and the arena goes into
Drought — nobody chose it from a menu, the deck said it.

## Two axes, deliberately different

| | Weather | Terrain |
|---|---|---|
| Set by | deck type counts | (undecided — see below) |
| Affects | **all** units | **grounded** units only |
| Reads as | falling particles from above | rising glow from the ground |

Flying (17 cards) ignores terrain. That is the point: it gives the flying
attribute a second job it does not currently have, without a new keyword.

## Rules taken from Pokémon Auto Chess, verified in source

Read from the local clone at `../pokemonAutoChess`:

- `app/utils/weather.ts` — `getWeather` counts type presence, dominant type wins,
  **a tie means no weather**. That tie rule is what stops flickering.
- `app/config/game/battle.ts` — `WeatherThreshold = 8`, sized for an auto-chess
  board. **Rescaled to 4** for our 6-card deck.
- `app/types/enum/Weather.ts` — the mapping:

  FIRE→DROUGHT · WATER→RAIN · ICE→SNOW · ELECTRIC→STORM · FLYING→WINDY ·
  GROUND→SANDSTORM · GRASS→ZENITH · DARK→NIGHT · FAIRY→MISTY · POISON→SMOG ·
  GHOST→MURKY · WILD→BLOODMOON

- PAC also gives "weather rocks" a **+3 score boost**. We have no items, so skip —
  but it is the obvious hook if we ever want a card that forces weather.

Terrain (canonical Pokémon set): Psychic, Electric, Grassy, Misty. Misty is the odd
one — it *punishes* Dragon rather than boosting a type.

## Coverage — measured 2026-09-01, against the current roster

Re-measured when `src/core/weather.ts` was written. **The earlier figures in this
file were stale** — they were taken when the roster held 127 cards, and it now
holds 151. Corrected:

| | then (127 cards) | now (151 cards) |
|---|---|---|
| Types with no weather | 5 | **7** |
| Cards that can never trigger it | 19 | **34** |

The seven unmapped types, by how many cards carry them:
**PSYCHIC (21), DRAGON (19), STEEL (19), NORMAL (15), FIGHTING (13), BUG (12),
ROCK (11)**. ROCK and NORMAL were missing from the old count.

NORMAL is unmapped on purpose: PAC maps it to a `NEUTRAL` weather, and a neutral
sky is the absence of weather rather than a kind of it. Giving it a name would
put something in the UI that does nothing.

The 34 cards that can never turn the sky on include a lot of the marquee ones —
mew, mewtwo, deoxys, dialga, jirachi, snorlax, scizor, heracross, latias, latios,
ditto, eevee.

Spread across the eleven weathers that do exist is healthy — every one of them is
reachable, and none dominates:

| Weather | Cards | Share |
|---|---|---|
| RAIN | 24 | 16% |
| WINDY | 18 | 12% |
| DROUGHT | 16 | 11% |
| ZENITH | 16 | 11% |
| SANDSTORM | 16 | 11% |
| MISTY | 15 | 10% |
| MURKY | 14 | 9% |
| NIGHT | 13 | 9% |
| SNOW | 10 | 7% |
| STORM | 10 | 7% |
| SMOG | 9 | 6% |

Two tests hold this honest: every weather must be reachable by some card, and
every weather must have at least `WEATHER_THRESHOLD` cards so a legal deck can
actually reach it. A weather nothing can trigger is decoration, not a rule.

The STEEL/PSYCHIC/DRAGON gap is the real balance question. A Steel deck can never
turn the sky on. Either invent weather for them, or accept it as a deliberate
"these types don't play the weather game" identity. **Still undecided.**

## Decided 2026-09-07

**Weather changes damage.** An earlier draft of this file called for a
visual-only first pass. That was wrong, and Duc said so: in Pokemon the weather
*is* the stat change. A sky that only recolours the screen is a filter, not a
mechanic.

### Both decks, one sky

There is one arena, so there is one answer, and it cannot depend on which seat is
asking -- a replay and a spectator have no seat. All twelve cards count as one
pool, threshold 4, **tie means no weather**.

Three consequences, all tested:

- **Counterplay.** Four Fire answered by four Water is a tie, so committing to a
  type can be denied by committing to the type that opposes it.
- **Mirror matches buff both sides.** Six Water against six Water gives Rain and
  +20% Water to everyone. It decides nothing, and it should look spectacular.
- **Two decks can trigger a weather neither earned alone.** Three and three
  reaches four. Symmetric, so it favours no seat.

### What a weather does

Each boosts the type that summoned it and damps that type's canonical answer.
Four are canon; the other seven are PAC inventions given the same shape, so the
pairing is guessable without a tooltip.

| Weather | Boosts | Damps | | Weather | Boosts | Damps |
|---|---|---|---|---|---|---|
| DROUGHT | FIRE | WATER | | ZENITH | GRASS | ROCK |
| RAIN | WATER | FIRE | | NIGHT | DARK | PSYCHIC |
| SNOW | ICE | GRASS | | MISTY | FAIRY | DRAGON |
| SANDSTORM | GROUND | FLYING | | SMOG | POISON | FAIRY |
| STORM | ELECTRIC | WATER | | MURKY | GHOST | NORMAL |
| WINDY | FLYING | BUG | | | | |

`WEATHER_SWING = 1.2`, and the damp is its exact reciprocal so a weather cannot
inflate total damage. **A hypothesis, not a settled number** -- tune on the
headless simulator. The type chart already reaches 4x, and canon's 1.5x on top
of that would let a matchup decide a match before anyone makes a decision.

### Where it plugs in -- one function

Measured, not assumed: **`combat.matchup()` is the only place a type multiplier
is computed**, and **`combat.applyHit()` is the only place damage is applied.**
Basic attacks (`tick.ts:66`, `tick.ts:188`) and signature abilities
(`combat.ts:308`) both take their multiplier from `matchup()`.

So weather reaches attacks *and* skills through a single four-line function. No
other call site changes.

### How often it actually fires

20,000 random deck pairings:

| | |
|---|---|
| No weather | **74.3%** |
| RAIN | 9.6% |
| WINDY | 3.6% |
| ZENITH / DROUGHT | 2.5% each |
| SANDSTORM | 2.3% |
| everything else | under 2% each |

Random decks are the floor, not the expectation -- players build to types. But
if weather should be common rather than special, the threshold is the dial.
RAIN leads because WATER has the most cards (24).

## Terrain -- from the arena, not the deck

If terrain were also deck-derived and also fixed at match start it would just be
a second weather: two rolls of the same dice off one lever.

**Weather is what you brought. Terrain is where you are.**

| | Weather | Terrain |
|---|---|---|
| From | both decks | the arena |
| Affects | everyone | grounded units only |
| Reads as | falling from above | glow rising from the ground |

This buys two things free: the four arena themes stop being a skin swap, and
flying gets a second job without a new keyword.

It also dissolves the old blocker -- *how does a type claim and hold the
ground?* Nothing claims it. The arena simply has it.

| Arena | Terrain | Fit |
|---|---|---|
| **amp** (AmpPlains) | Electric | exact |
| **forest** (ForestPath) | Grassy | exact |
| **meadow** (TinyMeadow) | Misty | plausible -- flowers |
| **magma** (MagmaCavern2) | *none* | deliberate: neutral ground |
| *CrystalCave1* | Psychic | a fifth arena, art already licensed |

Canon effects: Electric boosts Electric and blocks sleep; Grassy boosts Grass
and heals grounded units; Psychic boosts Psychic and blocks priority; **Misty
halves Dragon** rather than boosting Fairy, and blocks status.

### Grounded is not "not Flying type"

Duc's correction, and it is right: Jirachi, Mew, Mewtwo and several ghosts float
without carrying the Flying type.

**Three attempts to get this from data, all failed:**

- PAC declares **197 passives** and none of them is LEVITATE.
- Only **5 species** in our roster have a Hover animation.
- `feetOffset` (shadow distance) correlates but breaks -- floaters cluster at
  0-3 and grounded at 5-7, but Mewtwo is 6, Voltorb 5, Lugia 8. It measures body
  height, not flight.

So a floating list is **hand-authored: design, not extraction.** Say so rather
than implying the data decided. There is precedent -- `flying` is already
partly hand-set (`roster.ts` marks Gastly, which is GHOST/POISON).

The design argument is stronger than the canon one: terrain that spares only the
19 flying cards hits **132 of 151**, which is a global modifier rather than
something to build around.

## Build order

Weather is **visual first, mechanical later**, and the split is the whole point —
a sky that changes costs nothing in the engine and can ship alone. The moment
weather touches a stat, it becomes match-wide state that must reach the Java
engine and the 26 recorded differential matches. Those are two very different
sizes of job. Do not let them merge by accident.

1. Visual only, deck-derived, fixed at match start. Client-only. No engine change.
2. Terrain visual (ground glow), same rules.
3. Only then: stat effects, engine-side, with differential recordings redone.

## Assets

PAC ships what we need and we already have the clone:

- `app/public/src/assets/environment/` — `rain.png`, `snowflakes.png` (+json),
  `sand.png`, `smog.png`, `fog.png`, `sun.png`, `clouds.png`, `noise.png`,
  `lightcell.png`, `shine.png`.
- `app/public/src/game/components/weather-manager.ts` — 652 lines, 12 weather
  methods (`addRain`, `addDrought`, `addBloodMoon`, …), 6 particle textures,
  12 tint colours (`0x296383` rain, `0x460818` bloodmoon, `0x9a791a` sandstorm).
  Phaser particle emitters — we are on Phaser, so this ports nearly directly.

**Licence caution.** PAC's GPL-3.0 covers its *code*, not the Pokémon assets it
ships. Particle textures (rain, snow, fog) are generic enough to be safe or to
redraw in an hour; do not assume the licence carries.

## Where it sits on the board

Rotating rule modes, #6. Not urgent. But the *visual* pass is a weekend and it is
the single most striking change we could make to how a match looks.
