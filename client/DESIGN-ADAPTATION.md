# EMBERLINE, adapted to Lane Royale

*A read on the v0.1 draft against what we have actually built.*

---

## Verdict first

The draft is good and most of it we have already built without writing it down.
Its **appendix of "deliberately inherited" mechanics is a near-exact description
of our current game** — elixir clock with a punishing cap, double elixir, deck
cycle, two lanes, bridge as the tempo commitment, no unit control after
placement, role taxonomy, archetype-level counters instead of hard counters.

So the interesting question is not "should we adopt EMBERLINE". It is: **which
of its three genuinely new ideas are worth the cost, and which one do we already
have a better version of?**

My answer, up front:

| Idea | Verdict |
|---|---|
| **The Forge** (§5.2) | **Don't build it.** We already have a mechanic doing that exact job — see below |
| **Deploy delay, next-card preview, overtime** (§5.4–5.5) | **Steal immediately.** Cheap, and we are conspicuously missing them |
| **Designed counter-web** (§6.1) | **Real conflict.** Cannot emerge from our derived stats without new *mechanics* |
| **Deterministic lockstep** (§9) | **Wrong architecture for us.** Server-authoritative is far cheaper given what we built |
| Progression / monetization (§7) | Not applicable — this is a study project |

---

## 1. What we already have

Measured against the draft, not asserted:

| EMBERLINE calls for | We have | Where |
|---|---|---|
| Elixir clock, cap 10, punishing overflow | ✅ 0.4/s, cap 10 | `core/config.ts` |
| Double elixir final minute | ✅ at 60s remaining | `config.suddenDeathAt` |
| Deterministic deck cycle | ✅ rotation, played card to the back | `Match.drawFromDeck` |
| Two lanes + bridge as commitment point | ✅ river crossable only at bridges | `Match.goalFor` |
| No unit control after placement | ✅ units path alone | `Match.updateUnit` |
| Placement restricted to own half | ✅ | `Match.canDeploy` |
| Role taxonomy | ✅ 7 roles, derived from stats | `core/tiers.ts` |
| Win conditions that ignore units | ✅ tank + runner | `tiers.ignoresUnits` |
| Damage requires traversal (§8) | ✅ **by accident** — we have no spells at all | — |
| 3-minute match, tower-count win | ✅ | `Match.checkOver` |

Roughly two-thirds of the draft is already running. That is worth knowing before
anyone plans a rewrite.

---

## 2. The Forge: we already have a better version of it

The draft's rationale for the Forge (§5.2) is precise and correct:

> CR's first two minutes reward pure defense — the correct line is often to do
> nothing. The Forge makes doing nothing cost something.

**We solved that differently, and I think better: evolution.**

A card evolves after you play it twice (`evolution.PLAYS_FOR_STAGE`), and the
evolved form replaces it *in the hand and in the deck* for the rest of the
match. So:

- **Doing nothing has a compounding cost.** Turtle to 2:00 and you arrive at
  double elixir holding base forms while they hold second-stage cards.
- **It creates the same early-game skirmish** the Forge is for, without adding a
  third attention sink to a phone screen — which is the draft's own open
  question #1.
- **It is already built and tested.**

It is also a *better* differentiator on the draft's own terms:

| | Forge | Evolution |
|---|---|---|
| Makes the opening matter | ✅ | ✅ |
| Adds a third thing to watch | ❌ yes, a cost | ✅ no — it lives on cards you already read |
| Snowball risk (open question #2) | rate multiplier compounds | bounded — stages cap at 3 |
| Legible loss (pillar 2) | "I lost the middle" | "they grew Graveler and I never committed" |
| Already implemented | ❌ | ✅ |

**Recommendation: reject the Forge, and promote evolution from an
implementation detail to the stated pillar.** Our design doc never named it as
the differentiator; the draft's existence makes clear it should be.

The one thing the Forge does that evolution doesn't: it gives *cheap* cards a
job in the opening. Our cheap cards currently have no early role. Worth solving,
but with a card-design answer, not a map objective.

---

## 3. Steal these now

All cheap, all clearly missing, ordered by value per hour.

### 3.1 Deploy delay — **do this first**

We have **none**. A card drops and fights instantly. The draft's §5.4 is right
that this does three jobs, and a fourth for us: it is the single biggest reason
our matches feel twitchy rather than considered.

- Add `spawnDelay` to `Unit`; skip `updateUnit` while counting down.
- Render as a translucent, non-animated sprite — the LÖVE build never had this
  either, so it is new work, not a port.
- Start at **1.0s** as the draft says, then tune. It is inherited, not derived,
  and they say so.

### 3.2 Next-card preview

Trivial — `Match` already knows the queue. One card slot in the HUD. The draft
is right that cycle tracking is the highest-value invisible skill in the genre
and costs nothing to add.

### 3.3 Deploy on the enemy half after a tower falls

**We have a comment claiming this already works and no code that does it.**
`core/config.ts` says:

> Placement: you may only deploy on your own half, until you break a tower.

`Match.canDeploy` never checks tower state. The LÖVE version had the same lie.
Either implement it or delete the comment — a comment that overstates is worse
than none, and this one has survived two codebases.

### 3.4 Overtime

We currently tiebreak on **fractional remaining tower health**, which is
invisible to the player and anticlimactic. The draft's sudden-death-on-first-
tower-damage is better and is maybe 20 lines in `checkOver`.

### 3.5 King tower dormant until a lane tower falls

Flagged before and still open. Ours fires from second one, which makes the
middle safe and rushing the core unrewarding.

### 3.6 Air/ground targeting

We have fliers (Zubat, Gastly, Fletchling, Zapdos) but **everything can hit
everything**, so flying is pure upside with no counterplay. Add a `hitsAir` flag
derived from role or range and the draft's "Cinders punish ground-only defense"
dynamic appears for free.

---

## 4. The real conflict: derived stats vs a designed counter-web

This is the part of the draft that does **not** fit, and it is worth being
precise about why.

EMBERLINE §6.1 designs 18 cards so that `swarm > DPS > tank > swarm`, with
splash cutting across. That web is *authored*. Every card exists to answer
another card.

We generate cards from 1,149 species by formula. Our roles come from range,
speed and defence thresholds — which sorts creatures by **how far they reach**,
not by **what they beat**. The two taxonomies are not the same shape:

| EMBERLINE role | our nearest | gap |
|---|---|---|
| Win condition | tank / runner | ✅ we have this |
| Tank | tank | ✅ |
| DPS | bruiser / fighter | ~ no anti-tank bonus |
| **Splash** | — | ❌ **absent**; splash exists only on casts |
| **Swarm** | count > 1 | ~ only 3 cards, max 2 bodies |
| **Building** | — | ❌ absent |
| **Spell** | — | ❌ absent |
| Cycle | cheap fighters | ~ incidental, not designed |

Our actual distribution, measured:

```
fighter      9    skirmisher   8    runner  2
sniper       1    artillery    1    tank    1
multi-body:  Zubat x2, Caterpie x2, Eevee x2
```

Nine fighters and eight skirmishers is not a counter-web — it is one archetype
with a range slider.

**The resolution is not to hand-author 18 cards.** It is to add the *mechanics*
the web needs, and let the derivation key off them:

1. **Splash damage on basic attacks** for creatures whose ability is already
   area-typed. We have `config.skillRadius` for casts; extend it.
2. **Higher body counts.** PAC data has the species; our `FLAVOUR` table caps at
   2. A 4-body 2-cost is what makes splash matter.
3. **Buildings** as a card that does not move — the draft's Bramblewall role of
   redirecting building-targeters is exactly what our tank/runner win conditions
   need as a counter, and we currently have *no answer to them at all*.

Until those exist, no amount of card-adding produces the archetypes in §6.3.

---

## 5. Netcode: the draft picks the wrong architecture for us

§9 argues for deterministic lockstep with fixed-point math. It is a good
argument **for a project starting from zero**. We are not.

What we have:

- `core/` is already pure, headless, and runs under Node — `npm run sim` proves
  it every time.
- **14 float-math call sites** in the simulation path (`Math.hypot`, `Math.exp`,
  `atan2`). Lockstep needs every one replaced with fixed-point.
- RNG is already injectable (`Match({ rng })`), which is the *hard* part of
  determinism and we happen to have done it right.

So the cost split is lopsided:

| | Lockstep (draft) | Server-authoritative |
|---|---|---|
| Sim math rewrite to fixed-point | **required** | not required |
| Server runs our code | ✅ already can | ✅ already can |
| Cheat resistance | referee + hash compare | inherent |
| Bandwidth | inputs only | state deltas |
| Replays free | ✅ | ✅ (log inputs anyway) |
| **Work from where we stand** | **high** | **low** |

**Recommendation: server-authoritative, Colyseus, floats retained.** Our traffic
is a few discrete commands per player per minute — the draft's own §5.4 deploy
delay absorbs the latency, and state deltas at that rate are nothing.

Keep the draft's genuinely good discipline regardless: no wall-clock in the sim,
no unordered iteration, RNG only from the match seed. We already comply on all
three, and `selfcheck.ts` can assert it.

One blocker either way, already noted in the code: **`Match` holds both players'
private state.** Handing it to a client leaks the opponent's hand. That seam
needs cutting before any network work.

---

## 6. What to reject or defer

| Item | Why |
|---|---|
| **The Forge** | Evolution already does the job, with fewer attention sinks |
| **Tile grid (18×30)** | Our placement is continuous and works; snapping is cosmetic polish, not a mechanic |
| **Progression / unlocks (§7)** | No players, no monetization. The "no card levels" principle is worth keeping as a *stated* value though — our evolution is in-match growth, not account power, so we already comply |
| **18 hand-designed cards (§6.2)** | Conflicts with derivation. Take the *roles* it identifies, not the card list |
| **Patch cadence (§8)** | Requires a population. Our equivalent is `npm run sim` with a ±18-point confidence band at 30 games — worth remembering before "balancing" anything |

---

## 7. What I would actually do next

In order, with honest cost:

1. **Deploy delay** — half a day. Biggest single feel improvement available.
2. **Next-card preview** — an hour.
3. **Fix or delete the "deploy after tower falls" comment** — an hour either way.
4. **Overtime + dormant king tower** — half a day together. Both make the
   endgame legible.
5. **Air/ground targeting** — half a day. Makes our four fliers interesting.
6. **Splash on basic attacks + higher body counts** — a day. This is the one
   that unlocks §6.3's archetypes; everything before it is polish.
7. **Buildings** — a day. Our win conditions currently have no dedicated answer.
8. *Then* revisit whether the roster needs hand-authored cards at all.

Steps 1–5 are polish on a game that works. Step 6 is the one that changes what
the game *is*, and it is where I would spend the effort if only one thing gets
done.

---

## 8. The draft's best line, which we should adopt verbatim

> **Legible loss** — the player must be able to name the mistake that killed
> them.

We fail this today in one specific place: the match ends on fractional tower
health with no indication that was the deciding factor. Fixing overtime (§3.4)
is the concrete way to comply.

And its kill criterion is the right instinct applied to the wrong feature:

> If internal testers with the Forge disabled report a better match than with it
> enabled, the differentiator is wrong.

Ours should read: *if testers with evolution disabled report a better match, the
differentiator is wrong.* That is a test we can run today — it is one flag in
`Match.countPlay`.
