/** What a move does when it is not damage. */

import { config, forwardFor } from "./config";

/** PAC's shield figures are on its health scale, and ours are 2.6x that -- the same factor `tiers.STAT_SCALE` applies to ability damage, for the same reason: the r. */
const SHIELD_SCALE = 2.6;
import type { Tower, Unit } from "./match";
import { pushOutOfTowers } from "./movement";

export type SkillEffect =
  /** Restore health to the caster and nearby allies. */
  | { kind: "heal"; fraction: number }
  /** Give the caster's side elixir. PAC's prize money, in our currency. */
  | { kind: "elixir"; amount: number }
  /** Temporary health on the strongest nearby ally, or the caster if alone. */
  | { kind: "shield"; amount: number }
  /** Raise one of the caster's own stats, for as long as it lives. */
  | { kind: "buff"; stat: "speed" | "def" | "speDef"; multiplier: number }
  /** Jump the caster forward, past whatever is in the way. */
  | { kind: "blink"; distance: number };

/** The moves we model as something other than damage. */
export const MOVE_EFFECT: Record<string, SkillEffect> = {
  // Abra's whole identity, and the reason it survives at all: it is a 234-health
  // artillery piece that gets caught. Blinking forward past a front line is also
  // the one repositioning mechanic in the game that is not a delivery, so it
  // plays unlike anything else on the roster.
  TELEPORT: { kind: "blink", distance: 64 },

  // A delayed heal in the games; immediate here, because a deferred effect
  // needs its own timer and the difference is invisible in a three-minute match.
  WISH: { kind: "heal", fraction: 0.25 },

  // Happy Hour doubles prize money, which is a real ability in an auto-chess
  // with an economy and nothing at all in a lane battler -- so it fell through
  // to a generic nuke, and Eevee plus all eight eeveelutions cast it.
  //
  // Money is not meaningless here, though: it is elixir. Translating it is more
  // faithful than replacing it, and it gives the base form a reason to exist
  // before you have chosen a branch -- play Eevee for tempo, specialise later.
  //
  // One elixir, on a card that casts every ten attacks. Elixir generation is
  // the most swingy thing a card can do -- Clash Royale has rebalanced its
  // Collector more than almost any card it ships -- so this starts small.
  HAPPY_HOUR: { kind: "elixir", amount: 1 },

  // Not the enemy retype the name suggests -- that is the mainline meaning, and
  // it cost two wrong entries in this file before anyone read PAC's source:
  //
  //   requiresTarget = false
  //   const buffedUnit = strongestAlly ?? pokemon    // self-cast with no ally
  //   buffedUnit.addShield([15, 30, 60, 120][stars - 1])
  //
  // The Electric-synergy half does not translate; the shield is the substance.
  // It lands on Yamper, which is the game's only win condition -- and a win
  // condition's problem is exactly this: it ignores troops, so it is hit the
  // whole way to the tower and cannot hit back. Running ahead of everything
  // also means there is usually no ally, so in practice it shields itself.
  ELECTRIFY: { kind: "shield", amount: 15 },

  AGILITY: { kind: "buff", stat: "speed", multiplier: 1.35 },
  DEFENSE_CURL: { kind: "buff", stat: "def", multiplier: 1.6 },
  // Swaps Def and SpDef in the games. Raising the weaker one is the closest
  // honest reading that does not need a swap to be undone on death.
  WONDER_ROOM: { kind: "buff", stat: "speDef", multiplier: 1.6 },
};

/** What a move's damage is actually computed from. */
export type Powered = {
  /** Which stat the damage comes from. */
  from: "def" | "maxHP" | "attack" | "targetAttack";
  /** Per evolution stage, 1-4. */
  scale: number[];
  /** Raise the caster's own defence first, per stage. Rollout only. */
  boostDef?: number[];
};

export const POWERED: Record<string, Powered> = {
  IRON_TAIL: { from: "def", scale: [1, 1, 1, 2] },
  ROLLOUT: { from: "def", scale: [2, 2, 2, 2], boostDef: [2, 5, 10, 20] },
  BODY_SLAM: { from: "maxHP", scale: [0.3, 0.3, 0.5, 0.8] },
  FOUL_PLAY: { from: "targetAttack", scale: [2, 4, 6, 12] },
  METEOR_MASH: { from: "attack", scale: [1.0, 1.2, 1.4, 2.0] },
  WOOD_HAMMER: { from: "attack", scale: [4, 4, 8, 16] },
};

/** The one left as plain damage, on purpose, with the reason recorded. */
export const DELIBERATELY_DAMAGE = new Set(["TRANSFORM"]);

/** Apply a non-damage effect. Returns false when the move is an attack. */
export function applyEffect(
  match: { elixir: Record<number, number> },
  towers: Tower[],
  u: Unit,
  allies: Unit[],
  effect: SkillEffect | undefined,
): boolean {
  if (!effect) return false;

  if (effect.kind === "elixir") {
    // Capped like any other gain, so a long-lived Eevee cannot bank past the
    // bar and dump six cards at once.
    match.elixir[u.side] = Math.min(
      config.elixirMax, (match.elixir[u.side] ?? 0) + effect.amount);
    return true;
  }

  if (effect.kind === "shield") {
    // PAC gives it to the strongest *ally*, and to itself when there is none.
    // `allies` arrives already filtered to what is in range; the caller decides
    // range, this decides who among them.
    const others = allies.filter((o) => o !== u);
    const best = others.reduce<Unit | undefined>(
      (a, b) => (!a || b.maxHP > a.maxHP ? b : a), undefined);
    const on = best ?? u;
    // Scaled like every other figure taken from PAC, so a 15 there means the
    // same fraction of a health bar here.
    on.shield += effect.amount * SHIELD_SCALE;
    return true;
  }

  if (effect.kind === "heal") {
    const amount = u.maxHP * effect.fraction;
    // The caster and whatever it is standing with. A heal that only fixes the
    // healer is a worse version of more health, and priced the same.
    for (const o of allies) {
      o.hp = Math.min(o.maxHP, o.hp + amount);
    }
    return true;
  }

  if (effect.kind === "buff") {
    if (effect.stat === "speed") u.speed *= effect.multiplier;
    else if (effect.stat === "def") u.def = (u.def ?? 0) * effect.multiplier + 2;
    else u.speDef = (u.speDef ?? 0) * effect.multiplier + 2;
    return true;
  }

  // Blink forward, where forward is the way this side marches. `forwardFor`
  // rather than a hand-written sign: PLAYER is 1 and ENEMY is 2, so a `side === 0`
  // test -- which is what this said first -- sends the player's units backwards.
  //
  // Clamped to the board. Landing in the river is survivable, since the river
  // push runs every frame and will shove a non-swimmer back out, but landing
  // off the map is not.
  const to = u.y + effect.distance * forwardFor(u.side);
  u.y = Math.min(Math.max(to, 8), config.arenaHeight - 8);
  // Blinking ignores everything in between, which is the point -- but it must
  // not ignore where it lands. Without this Abra teleported *into* a tower and
  // finished the frame standing inside the stonework, which the "keeps ground
  // units out of towers" invariant caught on two of six matches.
  pushOutOfTowers(towers, u);
  return true;
}

/** What a powered move hits for, or undefined when the move is an ordinary one. */
export function poweredDamage(
  move: string | undefined,
  caster: { def: number; maxHP: number; damage: number; card?: { stage?: number } },
  target?: { damage?: number },
): number | undefined {
  const p = move ? POWERED[move] : undefined;
  if (!p) return undefined;

  const stage = Math.max(1, Math.min(4, caster.card?.stage ?? 1));
  const scale = p.scale[stage - 1] ?? p.scale[p.scale.length - 1];

  if (p.boostDef) {
    // Rollout raises its own defence *before* it strikes, so the first cast
    // already benefits -- and every later one hits harder because of it. That
    // is the ramp, and it needs no counter: the stat is the counter.
    caster.def += p.boostDef[stage - 1] ?? p.boostDef[p.boostDef.length - 1];
  }

  switch (p.from) {
    case "def": return caster.def * scale;
    case "maxHP": return caster.maxHP * scale;
    case "attack": return caster.damage * scale;
    case "targetAttack":
      // Nothing to borrow from a building; fall back to its own.
      return (target?.damage ?? caster.damage) * scale;
  }
}
