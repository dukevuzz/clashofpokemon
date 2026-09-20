# Arena identity — the map is the frame, not the field

Status: **PARKED 2026-09-01** — the method is solved and a preview is rendered.
Nothing is implemented in the game yet. Resume by exporting the wall block.

Picked up again? Read "How the scenery is actually built" first; the composition
rule there is the whole finding, and it is not obvious.

Renamed from "map scenery". The original framing — scatter some props around the
edge — was too small. Duc pointed at three Clash Royale arenas and the point
landed: **CR's arena identity lives almost entirely outside the play rect.**

## What Clash Royale actually does

From three reference screenshots (grass arena, pirate-ship arena, crystal arena):

1. **The play field is an island in a built world.** Not a tiled rectangle on a
   background — a stage with a themed environment wrapped around it.
2. **The surround carries the theme, not the floor.** The pirate arena's field is
   plain wooden deck; what makes it a pirate arena is the *ships* around it —
   hulls, masts, rigging, sails, bunting, coiled rope, cannonball piles.
3. **Side colour is environmental.** In the pirate arena the top half of the world
   has **red** sails and the bottom half **blue**. Player identity is painted into
   the scenery, not just the tower sprites.
4. **Spectator NPCs.** Barbarians, goblins and archers sit on the stairs and rails
   watching, and they animate. Nothing to do with gameplay; everything to do with
   the arena feeling inhabited.
5. **The river is themed too.** Ordinary blue water in the grass arena; in the
   crystal arena it is a glowing **magenta energy fissure** with cracked banks —
   same shape, completely different read.
6. **Bridges are themed** to match — plank, rope, stone.
7. **A few props sit inside the field**, on non-walkable decoration spots (the
   stone ruin in the grass arena). Most stay outside.
8. **Towers sit on raised plinths** with ladders, not flat on the ground.

## What we have instead

`drawSurround()` in `client/src/ui/arena.ts` fills the whole screen with
`0x121218` and draws diagonal stripes at **1.4% white opacity**. That is the
entire world outside the arena. Our four "themes" swap the *ground tileset* only.

So: CR changes the world, we change the floor. That is the gap.

## The finding that makes this cheap

**We already own the art and are throwing away 87% of it.**

Each DTEF set's `tileset_0.png` is 432x192 = 18x8 = **144 tiles**, laid out as
three 6-column blocks, each a complete 16-combination autotile:

| columns | x range | contents |
|---|---|---|
| 0-5 | 0-143 | **WALL** — full adjacency set |
| 6-11 | 144-287 | **SECONDARY** — water / lava / void, full adjacency set |
| 12-17 | 288-431 | **FLOOR** — plus scattered detail variants |

`tileset_1.png` and `tileset_2.png` are sparse *alternate* wall and floor styles.
There are also `_frame0/_frame1` sheets (432x2304) for animated tiles.

Our export (`client/src/data/ground-amp.json`) takes **18 tiles**:

- `grassPlain: [0]`, `grassTuft: [0]` — one tile, no variety
- `dirt`, `dirtEdgeL`, `dirtEdgeR` — all `[1]`, the same single tile
- `water` — the full 16-entry bitmask

**The entire wall layer was never exported.** The framed surround CR builds by
hand, we already have the tiles for, per theme, sitting unused in the corpus.

Two consequences:

- A **themed surround** is an export change plus a draw call, not an art hunt.
- A **themed river** is free — the secondary layer is already per-set, so the
  magma arena gets lava and the ice arena gets ice, exactly the magenta-fissure
  trick from the crystal arena.

Worth noting the flatness cuts the other way too: `ground.png` (legend-of-lua,
16px, MIT) has **6 grass plains + 10 tufts + 3 dirt variants**, while every DTEF
theme has one of each. The "nicer" themes are the visually flatter ones.

## How the scenery is actually built

Preview (rendered from real geometry and real assets):
https://claude.ai/code/artifact/e03a2b5d-2fa2-4d9a-9995-1292f5199faa

**Fill and carve, not scatter.** The first attempt strewed clumps of trees and
rock across open grass and it read as confetti. The correction came from PAC's
`assets/maps/` — **144 rendered map previews, one per dungeon, 384x288** — which
show how PMD itself composes these exact tilesets:

> The wall is ONE continuous mass and the floor is carved out of it.

That inversion is what gives a PMD map its long unbroken coastlines. Scattered
stamps can never produce them, however much you tune the scatter.

The method that works:

1. **Ground everywhere first**, from the theme's floor block, so carved clearings
   have something to be.
2. **Fill the whole surround with mass.**
3. **Subtract clearings** — but *not* beside the board. The flanks are only about
   three tiles wide, so a clearing there is a hole, not a clearing. They stay a
   solid treeline, which is what Clash Royale does with its flanks anyway.
4. **Assign material by region, not per clump.** A handful of seed points, each
   with a source set, nearest-seed wins. Per-stamp material speckles; per-region
   material keeps a stand of trees a stand of trees.
5. **Autotile the merged result** with a 9-slice from the wall block's ring:
   corners `0/2/12/14`, edges `1/6/8/13`, interior `15` (mask `ABCD`).
   Index 0 is *not* a standalone prop — it is the ring's top-left corner. There
   is no isolated-blob tile in DTEF; masses are built, never stamped.
6. **Pools go inside the mass**, from the secondary block, never scattered over
   open ground — again, straight off the map previews.
7. **Mix three sets per arena.** One is monotonous, more than three is noise.

Useful sets, by what their wall block actually draws:

| Looks like | Sets |
|---|---|
| Trees / canopy | DeepDuskForest1, TreeshroudForest1, MystifyingForest, AppleWoods, MurkyForest, PurityForest2 |
| Boulders / stone | AmpPlains, VastIceMountain |
| Crystals | CrystalCave1 |
| Ruins / brickwork | BuriedRelic1 |
| Lava rock | MagmaCavern2, DarkCrater |
| Snow / ice | FrostyForest, SkyTower |

**Still worth trying:** the 144 previews are usable *as* backdrops, not only as
reference — a dungeon map scaled behind the arena, which is closer to what Duc
meant by "a giant map behind". At 384x288 against a 524x912 surround they would
need scaling or tiling, so it is a different technique from the one above, not a
refinement of it.

## The one real constraint

The side bands are **about three tiles** (82 design px), and the generous-looking
band along the bottom is **not free space** — the elixir pips and the card hand
sit there. What a player actually sees is a thin L across the top and sides.

Cutting the board from **16 tiles to 13** is the only lever that buys a real
frame. The preview's last panel shows it. It is a genuine trade: the board is the
game. Decide it deliberately rather than discovering it late.

## Our unfair advantage: the spectators should be Pokemon

CR had to draw those NPC barbarians. **We have 341 creature sprites with idle
animations and 1,178 emotion portraits already imported.** Idle Pokemon watching
from the sidelines — reacting to a tower falling, cheering a push — costs no new
art at all. It is the single most distinctive thing we could put in the surround,
and it is the one thing CR cannot copy from us.

Obvious sources for who is watching: the two decks in play, the player's
collection, or the arena's own theme.

## What we have locally, already

### 1. PMD dungeon tilesets — 144 sets, 120 MB

`../pokemonAutoChess/app/public/src/assets/tilesets/` (from the PAC clone).

Named after Pokémon Mystery Dungeon: Explorers of Sky dungeons. Directly relevant:

- **SkyTower**, SkyPeak4thPass, SkyPeak7thPass, SkyPeakSummitPass
- TemporalTower, FutureTemporalTower, JoyousTower
- BuriedRelic1/2/3, SealedRuin, DeepSealedRuin, DarknightRelic, ConcealedRuins
- Forests: DuskForest, DeepDuskForest, MurkyForest, MystifyingForest, FoggyForest,
  TreeshroudForest, HowlingForest, IcicleForest, FrostyForest, PurityForest2/4/6/7
- Mountains: VastIceMountain(+Peak), DarkIceMountain(+Peak)

Format per set: `tileset_N.png` at **432×192**, plus `tileset_N_frame0/1.png` at
432×2304 for animated tiles, each with a `.json`, plus `metadata.json`.

**The scale is already right.** `client/src/data/terrain.json` is `tileSize: 24`,
and 432/18 = 24, 192/8 = 24. These are 24 px tiles. No rescaling.
(Note `client/src/data/ground.json` is the *other* set — 16 px, 34 frames, from
legend-of-lua, MIT, Challacade LLC. Four of five ground sets are DTEF; only that
one is legend-of-lua.)

This is by far the strongest option: right scale, right art style, right IP,
already on disk.

### 2. PAC environment props

`../pokemonAutoChess/app/public/src/assets/environment/` — `berry_trees.png`
(+ json, animated), `flower_pots.png`, `ground_holes.png`, `portal.png`,
`chest.png`. Small, each with frame metadata. Good for scattered detail rather
than a treeline.

### 3. The Desktop prop sheet — provenance unknown, BLOCKED

`~/Desktop/assets can be use in background to avoid empty space.png`

Measured: **1024×512 RGBA**, three rows, ~14 props per row, **42 props**
(38 connected components — some touch, e.g. the paired campfires).
Grid pitch ~= **68 x 132 px**; art ~= **56 x 120** (median), range 48-204 wide,
108-256 tall.

Contents: campfires, crystal spires, tombstones and graves, statues, tree stumps,
rock pillars, obelisks, torches, a sword in a stone, waterfall columns.

Two problems:

- **Licence unknown.** It arrived with no source. Our standing rule is that
  nothing enters the repo without a named public licence carrying a version
  number. **This cannot be committed until we know where it came from.**
- **Style mismatch.** Generic fantasy, not PMD. Next to the creature sprites it
  will read as borrowed. The scale is also off — 120 px tall against 24 px tiles
  is five tiles high, roughly 1.5x a creature (cells are 72x80).

Usable as *reference* for what kinds of props to pull from the PMD sets. Not as
shipped art, not yet.

## The licence question — already answered, no new decision

An earlier draft of this file treated "PAC's tilesets" and "DTEF" as two options.
**They are the same thing**, and we already ship them. Verified 2026-09-01:

- PAC's sets carry a `metadata.json` whose `maskDefinition` uses the DTEF mask
  vocabulary (`X, A, B, C, D, AB, AC, ... A1B, B2C, C3D`), 24 px tiles, 18
  columns, `tileset_0/1/2` plus `_frameN` files. That *is* DTEF —
  "256 adjacency combinations", per the format spec.
- **Four DTEF dungeon tilesets are already in this repo and already credited**:
  `ground-amp` (AmpPlains), `ground-forest` (ForestPath),
  `ground-meadow` (TinyMeadow), `ground-magma` (MagmaCavern2). Each names its
  source in its own json `credit` field, and `CREDITS.md` has a "Ground tilesets"
  section for them.
- They are **not byte-identical** to PAC's copies — a byte-exact scan of all 685
  432-px-wide sheets in PAC found no match. Ours were re-exported from the DTEF
  corpus into a single 432x24 strip plus a json describing it, not lifted from
  PAC's tree.

So pulling scenery from the same corpus is **consistent with what already ships**,
not a new step. The precedent is set and documented. No decision needed.

Two housekeeping notes:

- The old credit link `github.com/audinowho/DtefTilesets` **404s** (audinowho's
  account is live; that repo is gone). Fixed to
  [`github.com/SkyTemple/skytemple-dtef`](https://github.com/SkyTemple/skytemple-dtef),
  GPL-3.0, which is the format spec. The tileset *corpus* itself has no single
  canonical public home we have found — worth pinning down properly if we expand
  the credit.
- The GPL-3.0 on the spec covers the format and tooling, not Nintendo's tiles.
  Same caveat that `CREDITS.md` already makes for the 170 Spike Chunsoft sprites.

## Build sketch (once the source is settled)

1. Pick 2–3 tilesets matching the four arenas (a forest, a ruin, a mountain).
2. Extract only the decorative tiles — the PMD sets are mostly floor/wall
   bitmasks; the props are a minority of each sheet.
3. Scatter deterministically, **seeded by match id**, so both clients draw the
   identical scenery without syncing anything.
4. Draw into the existing baked `RenderTexture` in `client/src/ui/arena.ts`
   alongside `buildGround`. Static scenery costs one bake, not a per-frame draw.
5. Keep everything strictly outside the play rect — scenery must never be
   mistaken for something a unit can path around.

Ties into the weather plan: scenery is what weather lights up. A sandstorm over a
bare rectangle is much less convincing than one over rocks.
