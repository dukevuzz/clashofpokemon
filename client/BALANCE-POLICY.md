# Balance policy, derived from Clash Royale's 2025 record

*Not invented. Extracted from 13 balance events across 2025, and the 28
card-level changes with stated magnitudes.*

---

## The numbers

| | |
|---|---|
| Balance events in 2025 | **13** (monthly, plus one bonus patch in July) |
| WIP notes published before final | **8–10 days** ahead, from S72 onward |
| Cards per patch | **10–24** |
| Median change magnitude | **12%** |
| 25th / 75th percentile | **8% / 29%** |
| 90th percentile | 50% |
| Changes ≤ 15% | **54%** |
| Changes ≤ 25% | **75%** |
| Nerf : buff ratio | 17 : 11 — buffs are not an afterthought |

Nerf median 13%, buff median 12%. **They are the same size.** Buffing is not a
smaller or more timid act than nerfing.

---

## Rule 1 — the default correction is about 12%

Three quarters of everything a decade-tuned game does is 25% or smaller. If a
proposed change is bigger, it needs a reason that is not "it feels strong".

Our own record, graded by `npm run balance:diff`:

| change | size | verdict |
|---|---|---|
| tower health 950 → 2000 | +111% | **off the scale** — defensible: three cards soloed a tower and nineteen could not touch one. Structural, not tuning |
| legendary stats | −23 to −25% | at the 75th percentile. Large, but inside the envelope |
| fletchling | −2% | noise from a formula edit, not an intent |

The +111% is the one to be uncomfortable about. It was fixing a break, and
breaks get one big correction — but the *next* tower change should be 10%, not
another doubling.

## Rule 2 — nerf the interaction before the number

21% of their changes were timing or geometry rather than raw stats:

- Arrows **radius** 4 → 3.5 — because it hit tower and troops together
- Cannon **hit speed** 0.9 → 1.0s
- Goblin Gang **first-hit delay** 0.4 → 0.6s
- Barbarian Barrel **deploy time** 0.5 → 1.0s
- Electro Spirit **chain speed** 5 → 4 hits/s — *"more reaction time"*
- Three Musketeers **load staggered 50ms** — to reduce overkill

These are legible. A player feels a slower hit speed and can name it. A 6%
damage shave is invisible and unlearnable.

**We can barely do this.** Our levers are `hp`, `damage`, `speed`, `range`,
`attackRate`, `count`. We have **no deploy time, no first-hit delay, no ability
radius, no chain, no stagger**. So every correction we make is currently a
number nobody can perceive.

That is an argument for building deploy delay *for balance reasons*, not just
for feel.

## Rule 3 — expect to overshoot, and say so

Two entries in December are corrections of earlier corrections:

- **Void** damage 320 → 340 — *"last nerf overshot"*
- **Evo Royal Ghost** −22% — *"previous nerf didn't land"*

A patch that never revisits itself is not disciplined, it is unmeasured. Both
directions are normal. Our equivalent is: re-run `npm run sim` after every
change and be willing to walk one back.

## Rule 4 — chip damage keeps getting cut

The clearest through-line of the year:

| card | change | reason |
|---|---|---|
| Arrows | radius −13% | hit tower and troops together too easily |
| The Log | crown tower damage −24% | reduce incidental damage |
| Tornado | damage −50% | utility card doing damage work |
| Rage | damage −23% | same |

**Damage should require traversal.** Value taken from a tower should come from
something that crossed the map and survived.

We comply by accident — we have no spells at all. When we add them, they clear
and reposition; they do not chip towers.

## Rule 5 — state the reason, in the terms a player argues in

Their reasons are causal, not descriptive:

> *"Long-dominant; push players toward other buildings"* — Cannon
> *"Struggling since Tornado's nerf"* — Magic Archer

The second is the interesting one: **a buff justified by a different card's
nerf.** Second-order effects are tracked and named. A balance note that says
"reduced by 8%" and stops has not explained anything.

## Rule 6 — a big list is a symptom

10–24 cards is a patch. If ours ever needs forty, the problem is a formula, not
forty cards.

And that is our specific hazard: **our stats are derived, so a two-line edit to
`costOf` rewrites the entire roster with no diff to read.** Today's legendary
correction touched six cards' worth of stats from one function. Hence
`tools/balance-diff.ts` — without it, a formula change is invisible.

---

## What we do

```bash
npm run balance:snapshot   # before touching anything
# ... make ONE change ...
npm run balance:diff       # what moved, and is the size normal?
npm run sim -- 300         # did it do what you intended?
npm run check:self         # did it break an invariant?
```

**Order matters.** Snapshot first or there is nothing to compare against. One
change at a time or you cannot attribute the result.

And the sample-size discipline that has already caught us out twice:

| games per card | 95% confidence |
|---|---|
| 40 | ±15 points |
| 95 | ±10 |
| 300 | ±6 |

At 30 games a 46% → 35% swing is noise. Their *"any card above ~35% use rate is
a concern regardless of win rate"* has no analogue for us — use rate needs
players. Win rate plus a stated confidence band is all we have, and it is enough
if the band is always stated.

---

## The one we cannot copy

Their monthly cadence with WIP notes 8–10 days early exists to give a community
time to argue. We have no community, so our substitute is the harnesses: 681
invariants and 53 screen checks are what tells us a change was safe, in place of
ten days of players telling us it was not.
