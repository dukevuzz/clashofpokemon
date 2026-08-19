# Lane Royale

A two-lane tower battler in Phaser 3 + TypeScript, built on data extracted from
[pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess).

```bash
npm install
npm run dev      # play it at localhost:5173
npm run sim      # 80 headless matches, win rate per card
npm run check    # typecheck
npm run build    # production bundle
```

## The one rule of this codebase

**`src/core/` contains the game. Everything else draws it.**

Nothing in `core/` imports Phaser, touches the DOM, or draws anything. It takes
a time step and returns a list of events. That is not architectural decoration
— it is what lets the same code run the game, run the balance simulator, and (if
this ever goes online) run on a server with the client rendering what it is
told.

If you want to know **how the game works**, read the seven files in `core/` and
nothing else. If you want to know **what it looks like**, read `scenes/` and
none of `core/`.

## Where everything is

```
src/
  core/            the rules. no Phaser, no DOM, no drawing.
    config.ts        every tuned number: arena, elixir, towers, deck, clock
    species.ts       1,149 extracted species + the type-effectiveness chart
    tiers.ts         what a creature IS: rarity, role, armour, ability damage
    cards.ts         species -> playable card, and the cost formula
    evolution.ts     a card you keep playing grows into its next form
    match.ts         a whole match: units, towers, elixir, hands, clock, winner
    ai.ts            the opponent
    index.ts         barrel — `import { Match, cards } from "./core"`

  scenes/          Phaser. one file per screen.
    BootScene.ts     loads the roster's sheets, registers animations
    MenuScene.ts     dashboard: Play, Deck, Pokedex
    BattleScene.ts   steps a Match and renders its events
    DeckScene.ts     one deck, six slots, filter by cost or role
    DexScene.ts      searchable table over all 1,149 species

  ui/              shared presentation
    layout.ts        design space + world->screen mapping
    theme.ts         colours and text styles
    widgets.ts       panel, button, label
    card.ts          a card face: art, cost, types, rarity, evolution pips
    arena.ts         terrain tiles, bridges, tower art, water shimmer
    skillFx.ts       projectiles, impacts and ability casts
    sprites.ts       PMD atlases -> Phaser animations
    deckStore.ts     the chosen deck and Eevee branch, in localStorage

  data/            generated. do not edit by hand.
    species.json     1,149 species: hp, atk, def, speed, range, skill, rarity
    abilities.json   300 abilities with damage per evolution stage
    typeChart.json   the type chart, and PAC's synergies mapped onto it
    sheets.json      68 sprite sheet descriptors
    terrain.json     ground tiles and tower art
    attacks.json     per-element projectile / impact / melee frames
    abilityFx.json   20 signature-ability animations
```

## How a card gets its numbers

Nothing is hand-authored. A card is its species' stats, reinterpreted:

| what | from |
|---|---|
| health, damage, speed | the species' own `hp`, `atk`, `speed`, scaled |
| reach and aggro radius | its **role**, which comes from `range`/`speed`/`def` |
| how often it casts | `maxPP / 10` — PAC grants 10 PP per basic attack |
| what the cast hits for | the ability's declared damage at its evolution stage |
| **cost** | `cards.costOf` — see below |

### Cost

One formula, in `cards.ts`, and it is the only place a price is decided.

```
power  = hp/30 + atk/3 + (def + speDef)/8      scaled by how many bodies it spawns
       × 1.22 if it ignores units (a win condition)
       × 1.12 if it crosses the river anywhere
       × 1.15 if it flies

cost   = 0.7 × (power mapped onto the curve) + 0.3 × (its rarity's cost)
```

The mapping is **linear across the base forms and compressive above them**.
Both halves were learned the hard way:

- Linear everywhere put a legendary at cost 16 before clamping, so all three
  pinned to the ceiling and cost stopped telling them apart.
- Compressive everywhere (a plain square root) squeezed the base forms just as
  hard and dropped 12 of 22 cards onto the same cost of 3.

So base forms spread linearly over 1–5, and everything above bends
asymptotically toward 7.5. Rarity **pulls** the price rather than setting it —
it used to be a hard floor, which is how an `ultra` Gastly reached the board at
a common's price and won 86% of its matches with nothing in the system objecting.

## Win conditions

Most creatures fight whatever is nearest, so a push dissolves into a brawl in
midfield and towers only fall to what leaks through. A **win condition** ignores
units entirely and walks at the towers, which forces the opponent to answer
rather than trade. Two kinds:

- **tank** — `def ≥ 6, hp ≥ 90`. Walks through the fight slowly and soaks. It
  arrives *through evolution*: Geodude fights, Graveler sieges.
- **runner** — `speed ≥ 58`. Goes around the fight, crossing the river anywhere
  instead of queueing for a bridge.

A runner's viability is **survivability over trip time**, not the behaviour.
Yamper (234 hp) reaches the tower and still wins 39% of its matches; Raikou
(1170 hp) does the same job and wins 72%. A tower deals 34 damage a second, so
the arithmetic decides it before the design does.

Everything that is not a win condition falls in behind the nearest friendly one,
so a push arrives together instead of one at a time.

## Measuring changes

`npm run sim` plays headless matches with random decks and reports win rate,
tower damage and kills per card. It imports `core/`, so a result measured there
is a result about the game.

**Confidence matters more than the number.** At 40 games per card a win rate is
±15 points; it takes 300 to get inside ±6. A card that swings 46% → 35% between
runs with no change made is noise, and has been mistaken for a signal here more
than once.

Two known distortions, both the AI's fault rather than any card's:

- It deploys immediately at the threatened lane, so a card needing deliberate
  timing reads worse than it is.
- It had to be taught to save. Greedy "most expensive I can afford" can never
  buy above about 5, and the three 7-cost legendaries were deployed **zero
  times in 128 matches** before that was fixed.

## Casing bugs

Three separate features were silently dead in the LÖVE build because a lookup
table was capitalised one way and `typesOf` returned another:

| table | keyed | lookup | result |
|---|---|---|---|
| `cards.lua` flying test | `"Flying"` | `"FLYING"` | no card ever flew from its typing |
| `attackData` | `"Fire"` | `"FIRE"` | element effect frames never loaded |
| `SHAPE_FOR_TYPE` | `"Fire"` | `"FIRE"` | every projectile was the same grey circle |

None of them errored. All three are fixed here by normalising to uppercase at
conversion time rather than at each lookup, so there is one place to be wrong.

## Notes for later

- **Sprites are heavy.** Each sheet decodes to ~13 MB of texture memory, so the
  full 68 is 640 MB and the loader visibly stalls. Boot loads the 22 roster
  sheets; `BattleScene.preload` adds only the evolution chains its two decks can
  reach. Do not go back to loading them all.
- Missing archetypes: no buildings (siege), no spells (bait), and only one cheap
  win condition.
- `core/` is server-ready but there is no server. Colyseus is the obvious fit —
  it is what pokemonAutoChess uses.
