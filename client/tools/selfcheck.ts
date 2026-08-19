/** Invariants the game must satisfy, checked without a browser. */

import {
  Match, AI, config, cards, tiers, evolution,
  SPECIES, typesOf, towerTroops, type Card,
} from "../src/core/index.js";
import { SHEETS } from "../src/data/sheets.js";
import { FRAMES, referencedFrames } from "../src/data/effects.js";
import * as statusFx from "../src/core/status.js";
// Straight from the data, not from ui/arena, which imports Phaser and cannot
// load outside a browser.
import terrain from "../src/data/terrain.json" with { type: "json" };
const TOWER_ART = terrain.towers;

let failures = 0;
let checks = 0;

function ok(condition: boolean, label: string, detail = "") {
  checks++;
  if (!condition) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `  -- ${detail}` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

const finite = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n);

// ------------------------------------------------------------------- cards

section("roster");
for (const c of cards.ALL) {
  ok(c.elixir >= 1 && c.elixir <= 8, `${c.name} cost in range`, `cost ${c.elixir}`);
  ok(finite(c.hp) && c.hp > 0, `${c.name} has health`, `hp ${c.hp}`);
  ok(finite(c.damage) && c.damage > 0, `${c.name} has damage`, `dmg ${c.damage}`);
  // Zero is legal and means "building": a rooted card holds ground and never
  // advances. Negative or NaN is not, and neither is a card that moves but has
  // no aggro to notice anything with.
  ok(finite(c.speed) && c.speed >= 0, `${c.name} has a sane speed`, `speed ${c.speed}`);
  if (c.speed === 0) {
    ok(c.aggro > 0, `${c.name} is rooted but still notices things`);
    ok(!c.delivery && !c.jumpsRiver && !c.flying,
       `${c.name} is rooted, so it does not also arrive by some other means`);
  }
  ok(finite(c.range) && c.range > 0, `${c.name} has range`);
  ok(c.aggro >= c.range, `${c.name} notices at least as far as it reaches`,
     `aggro ${c.aggro} range ${c.range}`);
  ok(c.count >= 1, `${c.name} spawns at least one body`);
  ok(c.castEvery >= 2, `${c.name} casts at a sane rate`, `every ${c.castEvery}`);
  ok(Boolean(SHEETS[c.sheet]), `${c.name} has a sprite sheet`);
  // A win condition that cannot reach a tower is a dead card. Both the rule
  // and the price now read the same field, so this can no longer be true of a
  // card that is charged for it.
  if (!c.targets.includes("troop")) {
    ok(c.hp > config.towerDamage.side * 3,
       `${c.name} survives more than three tower shots`, `hp ${c.hp}`);
  }
}

section("cost formula");
{
  // Same inputs must always give the same price, or balance work is unrepeatable.
  const first = cards.ALL.map((c) => c.elixir);
  const again = cards.ALL.map((c) =>
    cards.costOf(SPECIES[c.id], c.rarity, c.count, {
      wincon: !c.targets.includes("troop"),
      jumps: c.jumpsRiver, flying: c.flying,
      // Same list as costOf's own inputs, or this checks a subset of itself.
      anywhere: cards.arrivesAnywhere(c.delivery),
    }),
  );
  ok(JSON.stringify(first) === JSON.stringify(again), "costOf is deterministic");

  // Every species must price inside the bar, not just the roster.
  let outOfRange = 0;
  for (const [id, info] of Object.entries(SPECIES)) {
    const cost = cards.costOf(info, tiers.rarityOf(id), 1, {});
    if (!(cost >= 1 && cost <= 8)) outOfRange++;
  }
  ok(outOfRange === 0, "every one of 1,149 species prices within 1..8",
     `${outOfRange} outside`);

  // The curve must actually spread, or cost stops being a decision.
  const spread = new Set(cards.ALL.map((c) => c.elixir));
  ok(spread.size >= 4, "roster uses at least four price points",
     `uses ${[...spread].sort().join(",")}`);
}

section("evolution");
for (const c of cards.ALL) {
  const line = evolution.lineOf(c.id);
  ok(line.includes(c.id), `${c.name} appears in its own line`);
  ok(new Set(line).size === line.length, `${c.name} line has no repeats`,
     line.join(">"));

  // Anything a match can reach must be buildable and drawable, or a card
  // evolves into nothing and the player sees a slot quietly stop working.
  for (const form of evolution.chainOf(c.id)) {
    ok(Boolean(SPECIES[form]), `${c.name} -> ${form} exists in the data`);
    ok(Boolean(SHEETS[form]), `${c.name} -> ${form} has a sheet`);
    // Every form must have a motion to attack with. Three used to have none and
    // stood in an idle pose while dealing damage; nine more played a ranged
    // firing animation while swinging. Both were invisible because the pose was
    // resolved from a priority list at draw time rather than recorded.
    const sheet = SHEETS[form];
    if (sheet) {
      const pose = c.range > 30 ? sheet.shoot : sheet.attack;
      ok(Boolean(pose), `${form} has an attack pose`, `range ${c.range}`);
      // The cast pose may be absent -- resolve() falls back to the attack, the
      // way every creature behaved before the field existed -- but if one is
      // recorded it must name a row the sheet carries.
      ok(!sheet.ability || Boolean(sheet.anims[sheet.ability]),
        `${form} cast pose exists on the sheet`, `${sheet.ability}`);
      // Deliberately NOT asserting that a melee card avoids "Shoot". Ten do use
      // it -- Onix, Steelix, Entei, Salamence and the eeveelutions among them --
      // and that is PAC's own declaration, not a fallback: in PAC those are
      // ranged attackers. Our melee/ranged split is ours, derived from
      // `range > 30`, so the disagreement is with our classification rather
      // than with the animation. Asserting a preference over the authority
      // would just mean overruling the source every time it is consulted.
    }
    const built = cards.build(form, c);
    ok(Boolean(built), `${c.name} -> ${form} builds`);
    if (built) {
      ok(finite(built.hp) && built.hp > 0, `${form} has health`);
      ok(built.elixir >= 1 && built.elixir <= 8, `${form} prices in range`,
         `cost ${built.elixir}`);
    }
  }
}
{
  const forms = evolution.branchesFor("eevee");
  ok(Boolean(forms), "eevee offers branches");
  ok((forms?.length ?? 0) >= evolution.BRANCH_OFFER,
     "eevee has at least as many forms as it offers", `${forms?.length} forms`);
  const offer = evolution.offerFor("eevee");
  ok((offer?.length ?? 0) === evolution.BRANCH_OFFER,
     "an eevee offer is exactly BRANCH_OFFER cards", `got ${offer?.length}`);
  ok(new Set(offer?.map((c) => c.id)).size === (offer?.length ?? 0),
     "an eevee offer has no duplicates");
}

section("types");
{
  let unmapped = 0;
  for (const id of Object.keys(SPECIES)) {
    for (const t of typesOf(id)) {
      // Every type a species reports must be one the chart can reason about,
      // or matchups silently return neutral.
      if (t !== t.toUpperCase()) unmapped++;
    }
  }
  ok(unmapped === 0, "every mapped type is uppercase", `${unmapped} were not`);

  // The casing class of bug that hit three separate features.
  const flyers = cards.ALL.filter((c) => c.flying).map((c) => c.name);
  ok(flyers.length > 0, "some cards fly", flyers.join(","));
  const birdTyped = cards.ALL.filter((c) => c.types.includes("FLYING"));
  for (const b of birdTyped) {
    ok(b.flying, `${b.name} is FLYING-typed and therefore flies`);
  }
}

// ------------------------------------------------------------------ matches

section("match rules");
{
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

  for (let g = 0; g < 6; g++) {
    const m = new Match({ rng });
    const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
    let steps = 0;
    let sawNegativeHp = false, sawOutOfBounds = false, sawBadElixir = false;
    let sawInsideTower = false;

    while (!m.over && steps < 20000) {
      m.update(1 / 30);
      p.update(m, 1 / 30);
      e.update(m, 1 / 30);
      steps++;

      for (const side of [config.PLAYER, config.ENEMY] as const) {
        const x = m.elixir[side];
        if (!finite(x) || x < -0.001 || x > config.elixirMax + 0.001) sawBadElixir = true;
      }
      for (const u of m.units) {
        if (u.hp < 0 || !finite(u.hp)) sawNegativeHp = true;
        if (!finite(u.x) || !finite(u.y)) sawOutOfBounds = true;
        if (u.x < 0 || u.x > config.arenaWidth) sawOutOfBounds = true;
        // Towers are solid. A melee unit used to walk to the *centre* of one to
        // get in range, so it stood inside the building while hitting it.
        // Against the drawn shape, not a square the width of the footprint.
        // A tower is a spire with a staircase and its mount sits high in the
        // art, so checking a square left the whole lower half unguarded and
        // players kept finding creatures standing on the steps.
        if (!u.flying) {
          for (const t of m.towers) {
            if (t.dead) continue;
            const half = config.towerSize[t.kind] / 2;
            const box = config.towerBox[t.kind];
            const dy = u.y - t.y;
            if (Math.abs(u.x - t.x) < half && dy > -box.up && dy < box.down) {
              sawInsideTower = true;
            }
          }
        }
      }
      // A pending choice with no UI to answer it would hang a real match.
      const offer = m.pendingChoice[config.PLAYER];
      if (offer) m.takeChoice(config.PLAYER, offer.id, offer.options[0].id);
    }

    ok(m.over !== undefined, `match ${g} reaches a result`, `after ${steps} steps`);
    ok(steps < 20000, `match ${g} terminates`);
    ok(!sawBadElixir, `match ${g} keeps elixir in range`);
    ok(!sawNegativeHp, `match ${g} never shows negative health`);
    ok(!sawOutOfBounds, `match ${g} keeps units on the board`);
    ok(!sawInsideTower, `match ${g} keeps ground units out of towers`);
    ok(m.towersLeft(config.PLAYER) + m.towersLeft(config.ENEMY) <= 6,
       `match ${g} tower count sane`);
  }
}

section("deploy delay");
{
  // The delay must actually hold a unit still, not merely be stored on it.
  // Exactly handSize cards, so all of them are dealt however the shuffle
  // lands. Switching the shuffle off would test a deal the game never does.
  const m = new Match({
    playerDeck: [cards.byId("onix") ?? cards.ALL[0], ...cards.ALL.slice(0, 3)],
  });
  m.elixir[config.PLAYER] = config.elixirMax;
  const slot = m.hand[config.PLAYER].findIndex((c) => c?.id === "onix");
  if (slot >= 0) {
    m.deploy(config.PLAYER, slot, 100, config.arenaHeight - 140);
    const u = m.units[0];
    const startY = u.y;
    for (let i = 0; i < 12; i++) m.update(1 / 30);
    ok(Math.abs(u.y - startY) < 0.5, "a landing unit does not move");
    ok(u.spawning > 0, "a landing unit is still spawning");
    for (let i = 0; i < 90; i++) m.update(1 / 30);
    ok(u.spawning <= 0, "the delay expires");
  }
  // Bigger creatures wait longer -- that is the whole design.
  const small = cards.byId("caterpie"), big = cards.byId("onix");
  if (small && big) {
    ok(big.deployDelay > small.deployDelay,
       "a bigger creature takes longer to deploy",
       `${big.name} ${big.deployDelay}s vs ${small.name} ${small.deployDelay}s`);
  }
}

section("movement");
{
  // A unit deployed on top of its own lane tower used to freeze forever: it
  // stepped into the footprint, got pushed radially back out, and repeated.
  const m = new Match({ playerDeck: cards.ALL.slice(0, 4) });
  m.elixir[config.PLAYER] = config.elixirMax;
  m.deploy(config.PLAYER, 0, config.laneX[0], config.arenaHeight - config.towerBackOff.side);
  const u = m.units[0];
  const startY = u.y;
  for (let i = 0; i < 150; i++) m.update(1 / 30);
  ok(startY - u.y > 20, "a unit spawned on its own tower walks past it",
     `travelled ${(startY - u.y).toFixed(0)} units`);

  // Mass must order the roster the way size does.
  const small = cards.byId("caterpie"), big = cards.byId("onix");
  if (small && big) {
    ok(big.mass > small.mass, "a bigger creature is harder to shove",
       `${big.name} ${big.mass} vs ${small.name} ${small.mass}`);
  }
  for (const c of cards.ALL) {
    ok(c.mass >= 0.4 && c.mass <= 2.2, `${c.name} mass is bounded`, `${c.mass}`);
  }

  // A fast unit dropped behind a slow one must get past it, or a push is just
  // a queue behind whatever is slowest.
  const tank = cards.byId("onix"), fast = cards.byId("yamper");
  if (tank && fast) {
    const race = new Match({ playerDeck: [tank, fast, ...cards.ALL.slice(0, 2)] });
    const slot = (id: string) => race.hand[config.PLAYER].findIndex((c) => c?.id === id);
    race.elixir[config.PLAYER] = config.elixirMax;
    race.deploy(config.PLAYER, slot("onix"), 120, config.arenaHeight - 220);
    for (let i = 0; i < 90; i++) race.update(1 / 30);
    race.elixir[config.PLAYER] = config.elixirMax;
    race.deploy(config.PLAYER, slot("yamper"), 120, config.arenaHeight - 200);
    for (let i = 0; i < 180; i++) race.update(1 / 30);
    const o = race.units.find((x) => x.card.id === "onix");
    const y = race.units.find((x) => x.card.id === "yamper");
    ok(Boolean(o && y && y.y < o.y),
       "a faster unit gets past a slower one in its way",
       o && y ? `gap ${(y.y - o.y).toFixed(0)}` : "a unit died");
  }
}

section("damage actually lands");
{
  // Every source of damage must be observed dealing some. Ranged attacks and
  // tower shots both used to emit an event carrying an amount that nothing
  // applied, so they dealt exactly zero for a hundred simulated matches while
  // still producing plausible-looking results.
  const rng = (() => { let s = 999; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  let towerDamage = 0, rangedDamage = 0, meleeDamage = 0, maxInFlight = 0;

  for (let g = 0; g < 4; g++) {
    const m = new Match({ rng });
    const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
    while (!m.over) {
      for (const ev of m.update(1 / 30)) {
        if (ev.type !== "hit") continue;
        if (ev.source.isTower) towerDamage += ev.amount;
        else if (ev.source.range > 30) rangedDamage += ev.amount;
        else meleeDamage += ev.amount;
      }
      maxInFlight = Math.max(maxInFlight, m.projectiles.length);
      p.update(m, 1 / 30);
      e.update(m, 1 / 30);
      const offer = m.pendingChoice[config.PLAYER];
      if (offer) m.takeChoice(config.PLAYER, offer.id, offer.options[0].id);
    }
    ok(m.projectiles.length < 200, "projectiles do not pile up unresolved",
       `${m.projectiles.length} left`);
  }

  ok(towerDamage > 0, "towers deal damage", `${towerDamage}`);
  ok(rangedDamage > 0, "ranged units deal damage", `${rangedDamage}`);
  ok(meleeDamage > 0, "melee units deal damage", `${meleeDamage}`);
  ok(maxInFlight < 120, "shots in the air stay bounded", `peak ${maxInFlight}`);
  console.log(`  (tower ${towerDamage}, ranged ${rangedDamage}, melee ${meleeDamage})`);
}

section("deploy rules");
{
  // Seeded. This used `new Match({})`, which falls back to Math.random, so the
  // deck -- and therefore the cost of the card in slot 0 -- changed every run.
  // Measured, it failed 2 runs in 6: whenever slot 0 held something the test's
  // elixir could not cover, three checks went red for no reason. A check that
  // fails at random is worse than no check, because it teaches you to skim
  // past red.
  let dseed = 4242;
  const m = new Match({
    rng: () => (dseed = (dseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff,
  });
  const card = m.hand[config.PLAYER][0]!;
  m.elixir[config.PLAYER] = 0;
  ok(!m.deploy(config.PLAYER, 0, 100, 400), "cannot deploy with no elixir");

  m.elixir[config.PLAYER] = config.elixirMax;
  ok(!m.deploy(config.PLAYER, 0, 100, 50), "cannot deploy in the enemy half");
  ok(!m.deploy(config.PLAYER, 0, -50, 400), "cannot deploy off the left edge");
  ok(!m.deploy(config.PLAYER, 0, 100, config.arenaHeight + 50),
     "cannot deploy below the board");

  const before = m.elixir[config.PLAYER];
  ok(m.deploy(config.PLAYER, 0, 100, 400), "can deploy in own half with elixir");
  ok(Math.abs(before - m.elixir[config.PLAYER] - card.elixir) < 0.001,
     "deploy charges exactly the card's cost");
  ok(m.units.length === card.count, "deploy spawns the card's body count",
     `${m.units.length} vs ${card.count}`);

  // The hand must refill, or a slot goes dead for the rest of the match.
  ok(m.hand[config.PLAYER][0] !== undefined, "the played slot refills");
}

section("deck rules");
{
  const deck = cards.newDeck();
  ok(deck.length === config.deckSize, "a new deck is full", `${deck.length}`);
  ok(new Set(deck.map((c) => c.id)).size === deck.length,
     "a new deck has no duplicate cards");

  // A short deck must not crash the match constructor.
  const short = cards.ALL.slice(0, 2);
  const m = new Match({ playerDeck: short, enemyDeck: short });
  ok(m.hand[config.PLAYER].filter(Boolean).length > 0,
     "a short deck still deals a hand");

  // Hands must never show the same card twice: it looks like a bug and wastes
  // a quarter of your options.
  const full = new Match({});
  for (const side of [config.PLAYER, config.ENEMY] as const) {
    const hand = full.hand[side].filter(Boolean) as Card[];
    ok(new Set(hand.map((c) => c.id)).size === hand.length,
       `side ${side} opening hand has no duplicates`, hand.map((c) => c.name).join(","));
  }
}

section("ability data");
{
  let missing = 0, negative = 0;
  for (const c of cards.ALL) {
    const a = tiers.abilityOf(c.skill);
    if (!a) { missing++; continue; }
    if (a.damage.some((d) => !finite(d) || d < 0)) negative++;
    const { amount } = tiers.skillDamage(c, c.damage * config.skillDamage);
    ok(finite(amount) && amount > 0, `${c.name} cast deals a real amount`, `${amount}`);
  }
  ok(negative === 0, "no ability has negative damage");
  console.log(`  (${missing} of ${cards.ALL.length} roster cards have no declared figure)`);
}

/** How big things actually look. */
section("how big things look");
{
  const bodies = cards.ALL
    .map((c) => SHEETS[c.sheet])
    .filter(Boolean)
    .map((s) => s.bodyWidth)
    .sort((a, b) => a - b);
  const median = bodies[Math.floor(bodies.length / 2)];

  ok(Math.abs(median - config.referenceBody) <= 2,
     "referenceBody still matches the roster's median body",
     `median ${median}px, config says ${config.referenceBody}px`);

  // A creature is measured in tiles, so the assertion survives any board size.
  const tiles = (bodyPx: number) =>
    (bodyPx * (config.unitSize / config.referenceBody)) / config.unitSize;

  ok(Math.abs(tiles(median) - 1) < 0.05,
     "a median creature draws one tile across", `${tiles(median).toFixed(2)} tiles`);
  ok(tiles(bodies[0]) > 0.45,
     "even the smallest creature is not a speck", `${tiles(bodies[0]).toFixed(2)} tiles`);
  // Measured on height, not width.
  //
  // Width is the opaque box of the resting pose, and for a winged creature
  // that is *wingspan*: Moltres is 79x36 while Zapdos is 45x42, so Moltres is
  // the shorter bird and twice as wide. Judging size by width called it four
  // tiles and would have had us drop it. Onix is the same error inverted -- a
  // colossal snake drawn coiled, 24px wide, one of the narrowest cards we have.
  //
  // Heights cluster tightly across the whole roster (26-47), which makes them
  // the honest measure of how large a creature reads.
  const heights = cards.ALL
    .map((c) => SHEETS[c.sheet])
    .filter(Boolean)
    .map((s) => s.bodyHeight)
    .sort((a, b) => a - b);
  // 3.2, not 3. The old bound was set when Onix was the tallest thing we
  // shipped, at 2.24 tiles. Xerneas is 3.05 -- a legendary stag being the
  // biggest silhouette on the board is the intended reading, not a fault. The
  // bound still exists to catch art that would span lanes.
  ok(tiles(heights[heights.length - 1]) < 3.2,
     "even the tallest creature fits the lane",
     `${tiles(heights[heights.length - 1]).toFixed(2)} tiles`);

  // The board must stay tall enough that the arena is not squeezed to nothing,
  // which is the mechanism that shrank the art in the first place.
  const HAND_Y = 1080 - 16 - 150, PIP_Y = HAND_Y - 24;
  const arenaScale = (PIP_Y - 18 - 76) / config.arenaHeight;
  ok(arenaScale > 0.9 && arenaScale < 2.2,
     "the arena fills the screen without being crushed", `scale ${arenaScale.toFixed(3)}`);
  ok(config.arenaWidth * arenaScale <= 620,
     "the board fits the design width",
     `${(config.arenaWidth * arenaScale).toFixed(0)} of 620px`);

  // Art and physics must agree that a creature is about a tile. If art grew and
  // crowding did not, a group renders as one pile; the reverse leaves gaps.
  const crowd = config.unitSize * config.crowding;
  ok(crowd > median * (config.unitSize / config.referenceBody) * 0.6,
     "bodies are not packed tighter than they are drawn",
     `crowd ${crowd.toFixed(1)} vs drawn width ` +
     `${(median * (config.unitSize / config.referenceBody)).toFixed(1)}`);
  ok(config.crowding > 0.5 && config.crowding <= 1,
     "crowding leaves a group overlapping but countable", `${config.crowding}`);
}

/** Tower troops. */
/** Snapping a missed drop. */
section("dropping a card");
{
  // Seeded, and rich. `canDeploy` tests affordability as well as position, so
  // an unseeded match whose slot 0 held an expensive card failed every point in
  // the sweep -- 4176 of 4176 -- and reported it as a snapping bug. The check
  // is about geometry; the elixir has to be out of the way for it to say so.
  let sseed = 271828;
  const m = new Match({
    rng: () => (sseed = (sseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff,
  });
  m.elixir[config.PLAYER] = config.elixirMax;
  let illegal = 0, moved = 0, tried = 0;
  for (let x = -40; x <= config.arenaWidth + 40; x += 13) {
    for (let y = -40; y <= config.arenaHeight + 40; y += 13) {
      for (const approach of [x - 60, x + 60]) {
        const at = m.nearestDeploy(config.PLAYER, x, y, approach);
        tried++;
        if (!m.canDeploy(config.PLAYER, 0, at.x, at.y)) illegal++;
        if (at.x !== x || at.y !== y) moved++;
      }
    }
  }
  ok(illegal === 0, "every snapped drop point is legal",
     `${illegal} of ${tried} were not`);
  ok(moved > 0, "snapping actually moves impossible drops", `${moved} of ${tried}`);

  // A legal point must be left exactly where it is, or aiming stops working.
  //
  // Open ground between the river and the lane tower. This used to test a
  // point 120 up from the baseline, which is 48 below the tower's own centre
  // -- fine when a tower was a 72-unit square, and on the staircase once the
  // box matched the art. The check was asserting the old shape, not the rule.
  const clearY = (config.arenaHeight / 2 + config.deployMargin +
                  (config.arenaHeight - config.towerBackOff.side -
                   config.towerBox.side.up)) / 2;
  const good = m.nearestDeploy(config.PLAYER, config.laneX[0], clearY);
  ok(good.x === config.laneX[0] && good.y === clearY,
     "a legal drop in open ground is not nudged", JSON.stringify(good));

  // Coming at a tower from the left must land left of it, and vice versa.
  const t = m.towers.find(
    (o) => o.side === config.PLAYER && o.kind === "side" && o.x === config.laneX[0])!;
  const fromLeft = m.nearestDeploy(config.PLAYER, t.x, t.y, t.x - 60);
  const fromRight = m.nearestDeploy(config.PLAYER, t.x, t.y, t.x + 60);
  ok(fromLeft.x < t.x, "dragging from the left lands left of the tower", `${fromLeft.x}`);
  ok(fromRight.x > t.x, "dragging from the right lands right of the tower", `${fromRight.x}`);
}

/** Tunnelling. */
section("tunnelling");
{
  const diggers = cards.ALL.filter((c) => cards.arrivesAnywhere(c.delivery));
  ok(diggers.length >= 1, "something tunnels", diggers.map((c) => c.name).join(","));
  ok(diggers.length <= 2, "tunnelling stays rare", `${diggers.length} cards`);
  for (const d of diggers) {
    ok(d.deployDelay >= 0.8,
       `${d.name} lands slowly enough to be answered`, `${d.deployDelay}s`);
  }

  const dig = diggers[0];
  const m = new Match({
    playerDeck: [dig, ...cards.ALL.filter((c) => c !== dig).slice(0, 3)],
  });
  m.elixir[config.PLAYER] = config.elixirMax;
  // Which slot the tunneller landed in is the shuffle's business, so ask
  // rather than assume. Assuming slot 0 was the same thing as assuming the
  // deck is dealt in the order it was written, which it no longer is.
  const digSlot = m.hand[config.PLAYER].findIndex((c) => c?.id === dig.id);
  const king = m.towers.find((t) => t.side === config.ENEMY && t.kind === "king")!;
  ok(digSlot >= 0, `${dig.name} is dealt`, `slot ${digSlot}`);
  ok(m.canDeploy(config.PLAYER, digSlot, king.x - 70, king.y + 60),
     `${dig.name} may surface in the enemy half`);
  ok(!m.canDeploy(config.PLAYER, digSlot, king.x, -20),
     "a tunneller is still on the board");

  const plain = cards.ALL.find((c) => !c.delivery)!;
  const m2 = new Match({ playerDeck: [plain, ...cards.ALL.slice(0, 3)] });
  m2.elixir[config.PLAYER] = config.elixirMax;
  const plainSlot = m2.hand[config.PLAYER].findIndex((c) => c?.id === plain.id);
  ok(!m2.canDeploy(config.PLAYER, plainSlot, king.x - 70, king.y + 60),
     `${plain.name} may not -- the rule still binds everything else`);

  // Snapping must not quietly drag a tunneller home, and must still keep it
  // out of the stonework.
  const at = m.nearestDeploy(config.PLAYER, king.x, king.y + 60, king.x, true);
  ok(at.y < config.arenaHeight / 2, "snapping leaves a tunneller in their half",
     JSON.stringify(at));
  ok(m.canDeploy(config.PLAYER, digSlot, at.x, at.y),
     "and leaves it somewhere legal");
}

/** Deliveries. */
section("deliveries");
{
  const byMode = (m: string) => cards.ALL.filter((c) => c.delivery === m);
  ok(byMode("tunnel").length >= 1, "something tunnels");
  ok(byMode("throw").length >= 1, "something is thrown");
  ok(byMode("drop").length >= 1, "something is dropped");

  for (const c of byMode("drop")) {
    ok(!cards.arrivesAnywhere(c.delivery),
       `${c.name} drops in its own half only`, "a droppable tank would be a different game");
    ok(c.deployDelay >= 1.0,
       `${c.name} falls slowly enough to walk out from under`, `${c.deployDelay}s`);
  }
  for (const c of [...byMode("tunnel"), ...byMode("throw")]) {
    ok(cards.arrivesAnywhere(c.delivery), `${c.name} arrives anywhere`);
    // The cheap fragile end, as Clash Royale gives free placement.
    ok(c.elixir <= 4, `${c.name} is cheap enough to earn free placement`, `cost ${c.elixir}`);
    ok(c.hp <= 400, `${c.name} is fragile enough to earn it`, `hp ${c.hp}`);
  }
  // A delivery is a property of the line, not of one form. Reading it from the
  // base form's entry alone meant every evolved form silently lost it -- and
  // with it the minimum flight time that makes the card answerable.
  for (const c of cards.ALL.filter((c) => c.delivery)) {
    let cur = c;
    for (;;) {
      const next = evolution.nextOf(cur.id);
      if (!next) break;
      const built = cards.build(next, cur);
      ok(built?.delivery === c.delivery,
         `${c.name} -> ${next} keeps its ${c.delivery}`, `got ${built?.delivery}`);
      ok((built?.deployDelay ?? 0) >= config.deliveryTime[c.delivery!],
         `${next} keeps the ${c.delivery} flight time`,
         `${built?.deployDelay?.toFixed(2)}s < ${config.deliveryTime[c.delivery!]}s`);
      cur = built!;
    }
  }

  // Every delivery needs the pose it is drawn in.
  for (const c of cards.ALL.filter((c) => c.delivery)) {
    const want = c.delivery === "tunnel" ? "DigIn" : "Hop";
    ok(SHEETS[c.sheet]?.anims?.[want] !== undefined,
       `${c.name} has the ${want} animation its delivery needs`,
       Object.keys(SHEETS[c.sheet]?.anims ?? {}).join(","));
  }
}

section("tower troops");
{
  const { TROOPS, sustainedDps, burstDps, troopById, DEFAULT_TROOP } = towerTroops;
  ok(TROOPS.length >= 3, "there is a real choice", `${TROOPS.length} troops`);
  ok(troopById(DEFAULT_TROOP) === TROOPS[0], "the default resolves");
  ok(troopById("nonsense-id") === TROOPS[0], "an unknown id falls back, never throws");

  const plain = config.towerDamage.side / config.towerRate;
  for (const t of TROOPS) {
    ok(SHEETS[t.species] !== undefined, `${t.name} has art we ship`, t.species);
    // A troop that could still evolve would change species mid-match.
    ok(evolution.nextOf(t.species) === undefined,
       `${t.name} is a terminal form`, `next=${evolution.nextOf(t.species) ?? "-"}`);
    ok(t.hp > 0 && t.damage > 0 && t.rate > 0 && t.reach > 0,
       `${t.name} has sane numbers`);
    ok(sustainedDps(t) <= plain * 1.1,
       `${t.name} is not a straight upgrade on sustained damage`,
       `${sustainedDps(t).toFixed(1)} vs the plain tower's ${plain.toFixed(1)}`);
    ok(burstDps(t) >= sustainedDps(t) - 0.01,
       `${t.name} bursts at least as hard as it sustains`);
    if (t.volley) {
      ok(t.volley.shots >= 2 && t.volley.reload > 0,
         `${t.name} has a real magazine`, JSON.stringify(t.volley));
      ok(sustainedDps(t) < burstDps(t),
         `${t.name} pays for its burst`,
         `${sustainedDps(t).toFixed(1)} sustained vs ${burstDps(t).toFixed(1)} burst`);
    }
    // Reach must leave the tower able to cover its own bridge approach.
    ok(t.reach >= 100 && t.reach <= 220, `${t.name} reach is in band`, `${t.reach}`);
  }

  // Spread: if the best sustained is far above the worst, the picker is a trap.
  const dps = TROOPS.map(sustainedDps);
  ok(Math.max(...dps) / Math.min(...dps) < 1.6,
     "no troop out-damages another by more than half again",
     `${Math.min(...dps).toFixed(1)} to ${Math.max(...dps).toFixed(1)}`);

  // A tower creature has to have a firing pose, or it sits idle through every
  // shot and reads as an ornament. Every candidate in the source art ships a
  // PMD "Shoot"; the failure mode is converting one without asking for it,
  // which is exactly what happened to Mewtwo the first time.
  for (const t of TROOPS) {
    ok(SHEETS[t.species]?.anims?.Shoot !== undefined,
       `${t.name} has a firing animation`,
       `has ${Object.keys(SHEETS[t.species]?.anims ?? {}).join(",")}`);
  }
  ok(SHEETS[towerTroops.KING_SPECIES]?.anims?.Shoot !== undefined,
     "the king's creature has a firing animation");

  // The king's creature is decoration, and has to stay that way.
  ok(SHEETS[towerTroops.KING_SPECIES] !== undefined,
     "the king's creature has art we ship", towerTroops.KING_SPECIES);
  ok(SHEETS[towerTroops.KING_SPECIES]?.anims?.Idle !== undefined,
     "the king's creature has an Idle animation to sit in");
  ok(evolution.nextOf(towerTroops.KING_SPECIES) === undefined,
     "the king's creature is a terminal form");

  // A troop only ever rewrites a lane tower.
  const m = new Match({ playerTroop: "crobat" });
  const kings = m.towers.filter((t) => t.kind === "king");
  ok(kings.every((t) => t.maxHP === config.towerHP.king && !t.volley),
     "a troop never touches the king");
  const mine = m.towers.filter((t) => t.kind === "side" && t.side === config.PLAYER);
  ok(mine.every((t) => t.maxHP === troopById("crobat").hp),
     "the chosen troop reaches both of your lane towers");
  const theirs = m.towers.filter((t) => t.kind === "side" && t.side === config.ENEMY);
  ok(theirs.every((t) => t.maxHP === troopById(DEFAULT_TROOP).hp),
     "your troop does not leak onto their towers");
}

section("sprite sheets are not stale");
{
  // Converting a species is not idempotent against the converter's anim list,
  // and nothing noticed for months. `Attack` was in DEFAULT_ANIMS from the
  // start, `Shoot` was added in f2ef380 and `Hop`/`DigIn` in cca6bf8 -- so
  // every sheet converted before each of those is missing rows that exist in
  // the source. It surfaced as 25 of 119 playable forms attacking from an idle
  // pose, and as Yamper walking across the river before that.
  //
  // Need-based rather than blanket: a sheet missing `Hop` only matters if the
  // card leaps or is delivered, and demanding every anim on every sheet would
  // fail 83 of 125 for animations nothing plays.
  for (const c of cards.ALL) {
    const anims = SHEETS[c.sheet]?.anims ?? {};
    if (c.jumpsRiver || c.delivery) {
      ok(Boolean(anims.Hop), `${c.name} leaps or is delivered, so it needs Hop`,
         `has ${Object.keys(anims).join(",")}`);
    }
    if (c.delivery === "tunnel") {
      ok(Boolean(anims.DigIn), `${c.name} tunnels, so it needs DigIn`);
    }
  }
}

section("status effects");
{
  // The rule the whole system rests on: a plain attack never causes a status.
  // Only a cast does, and casts are 3.1% of damage events. If this ever starts
  // firing off ordinary hits, the game has quietly become something else.
  for (const [skill, e] of Object.entries(statusFx.MOVE_STATUS)) {
    ok(e.chance > 0 && e.chance <= 1, `${skill} has a real chance`, `${e.chance}`);
    ok(e.seconds > 0 && e.seconds <= 8, `${skill} lasts a sane time`, `${e.seconds}s`);
  }
  const carriers = cards.ALL.filter((c) => statusFx.MOVE_STATUS[c.skill]);
  ok(carriers.length > 0, "some cards carry a status move",
     carriers.map((c) => c.name).join(","));

  const rng = (() => { let s = 909; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  let applied = 0, hits = 0, dupes = 0, negative = 0, onTower = 0;
  for (let g = 0; g < 4; g++) {
    const m = new Match({ rng });
    const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
    let steps = 0;
    while (!m.over && steps++ < 20000) {
      for (const ev of m.update(1 / 30)) {
        if (ev.type === "hit") hits++;
        if (ev.type === "status") applied++;
      }
      p.update(m, 1 / 30); e.update(m, 1 / 30);
      for (const u of m.units) {
        const kinds = u.statuses.map((x) => x.kind);
        if (new Set(kinds).size !== kinds.length) dupes++;
        if (u.statuses.some((x) => x.left <= 0)) negative++;
      }
      for (const t of m.towers) if ((t as unknown as { statuses?: unknown }).statuses) onTower++;
    }
  }
  ok(applied > 0, "statuses do land in a real match", `${applied} over 4 matches`);
  // Loose upper bound rather than a tight one: this is a guard against a status
  // leaking onto the ordinary attack path, not a balance assertion.
  ok(applied / Math.max(1, hits) < 0.05,
     "a status is rare, because only casts cause one",
     `${(100 * applied / Math.max(1, hits)).toFixed(2)}% of hits`);
  ok(dupes === 0, "a unit never holds the same status twice", `${dupes}`);
  ok(negative === 0, "an expired status is removed, not left at zero", `${negative}`);
  ok(onTower === 0, "towers are never afflicted", `${onTower}`);
}

section("the river is solid");
{
  // The river was a painting for most of this project's life -- its own config
  // comment said "cosmetic only; nothing in core reads it" -- so anything that
  // could walk, walked over it. A player watched an Espeon cross open water.
  // This is the check that would have caught it.
  const top = config.riverY - config.riverHeight / 2;
  const bot = config.riverY + config.riverHeight / 2;
  const onBridge = (x: number) =>
    config.bridgeX.some((bx) => Math.abs(x - bx) <= config.bridgeHalfWidth);

  for (const bx of config.bridgeX) {
    ok(bx - config.bridgeHalfWidth > 0 && bx + config.bridgeHalfWidth < config.arenaWidth,
       "a bridge is inside the board", `${bx}`);
  }
  // Each bridge must contain its own lane, or a unit walking the lane arrives
  // beside the planks and is turned back by water it is standing next to.
  for (let i = 0; i < config.laneX.length; i++) {
    ok(onBridge(config.laneX[i]), `lane ${i} leads onto its bridge`,
       `lane ${config.laneX[i]} vs bridge ${config.bridgeX[i]}`);
  }

  // The deploy line must sit on dry land. Otherwise half the water is legally
  // yours to drop into, and a card placed there is standing in the river before
  // it has taken a step -- which is how 1,447 frames of swimming survived the
  // fix that was supposed to end swimming.
  ok(config.deployMargin >= config.riverHeight / 2,
     "the deploy line clears the water",
     `margin ${config.deployMargin} vs half-river ${config.riverHeight / 2}`);

  const rng = (() => { let s = 4242; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  let swam = 0, crossed = 0, seen = 0, waded = 0, overran = 0;
  for (let g = 0; g < 3; g++) {
    const m = new Match({ rng });
    const p = new AI(config.PLAYER, rng), e = new AI(config.ENEMY, rng);
    let steps = 0;
    while (!m.over && steps++ < 20000) {
      m.update(1 / 30); p.update(m, 1 / 30); e.update(m, 1 / 30);
      for (const u of m.units) {
        if (u.dead) continue;
        // Conditional on the switch: with `riverBypass` off a flier is a
        // walker as far as the water is concerned, so exempting it here would
        // stop this invariant from watching the creatures that changed.
        if (config.riverBypass && u.flying) continue;
        if (u.leap) {
          if (u.leap.t > config.leapTime + 0.1) overran++;
          continue;
        }
        if (u.jumpsRiver) {
          if (u.y > top && u.y < bot && !onBridge(u.x)) waded++;
          continue;
        }
        seen++;
        if (u.y > top && u.y < bot) { if (onBridge(u.x)) crossed++; else swam++; }
      }
    }
  }
  ok(swam === 0, "nothing that cannot swim ends a frame in open water",
     `${swam} of ${seen} samples`);
  // A jumper is allowed over the water, but only in the air. Standing in it is
  // the thing a player reported as a dog walking across a river.
  ok(waded === 0, "a river-jumper is never in the water except mid-leap",
     `${waded} samples`);
  ok(overran === 0, "no leap outlasts its own duration", `${overran} samples`);
  // And the opposite failure: a wall nothing can pass is not a river either.
  ok(crossed > 0, "ground units do still cross at the bridges", `${crossed} samples`);
}

section("tower art agrees with tower physics");
{
  // The drawing and the collision box are two descriptions of one building, and
  // nothing forced them to match. Twice now a player has been the thing that
  // noticed they had drifted: once with creatures standing on stonework the
  // physics thought was empty, once with riders seated below their plate.
  //
  // `mount` is the row the art hangs from, so it splits the art's height into
  // the two halves of towerBox at the scale the art is drawn at. If someone
  // retunes towerBox without moving the mount, the tower is drawn somewhere
  // other than where it can be walked into, and this says so.
  for (const kind of ["side", "king"] as const) {
    const art = TOWER_ART[kind];
    const z = config.towerSize[kind] / art.w;
    const box = config.towerBox[kind];
    const [, my] = art.mount;
    ok(Math.abs(my * z - box.up) < 1.5,
       `${kind} tower art reaches its collision box upward`,
       `art ${(my * z).toFixed(1)} vs box ${box.up}`);
    ok(Math.abs((art.h - my) * z - box.down) < 1.5,
       `${kind} tower art reaches its collision box downward`,
       `art ${((art.h - my) * z).toFixed(1)} vs box ${box.down}`);
    // The seat is a separate point and must stay one: making them equal again
    // is exactly the regression that sank every rider onto the ledge.
    const [sx, sy] = art.seat;
    ok(sy !== my, `${kind} tower seat is not its mount`, `both ${sy}`);
    ok(sy >= 0 && sy <= art.h && sx >= 0 && sx <= art.w,
       `${kind} tower seat is inside its art`, `${sx},${sy}`);
  }
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
  (failures ? `  --  ${failures} FAILED` : "  --  all good"),
);
process.exit(failures ? 1 : 0);

// ------------------------------------------------------------------ effects

section("effect atlas");
{
  // Every frame an effect names must exist, or the animation quietly plays
  // short -- Phaser drops frames it cannot resolve rather than complaining.
  const referenced = referencedFrames();
  const missing = referenced.filter((f) => !FRAMES[f]);
  ok(missing.length === 0, "every effect frame is in the atlas",
     `${missing.length} missing of ${referenced.length}`);

  // A trimmed frame carries the offset it was cut from. An offset that puts it
  // outside its own cell means the effect drifts as it plays: invisible in a
  // still, obvious in motion, and exactly what trimming risks getting wrong.
  let strayed = 0, total = 0;
  for (const f of Object.values(FRAMES)) {
    total++;
    const [, , w, h, ox, oy, sw, sh] = f;
    if (ox + w > sw + 1 || oy + h > sh + 1) strayed++;
  }
  ok(strayed === 0, "no trimmed effect frame sits outside its own cell",
     `${strayed} of ${total}`);
}
