/**
 * Moves that are not attacks.
 *
 * PAC records a damage figure for 300 of its 531 abilities; the rest are heals,
 * buffs and movement, and the fallback turned every one of them into "hit the
 * target, splash the crowd for half". Fourteen of 57 cards cast the identical
 * effect under different names -- Teleport as a nuke, Agility as a nuke, Wish
 * as a nuke, and Happy Hour, which doubles prize money and does nothing at all
 * in a battle, as a nuke.
 *
 * These check that a move does what the move is.
 */

import { describe, it, expect } from "vitest";
import { Match } from "../src/core/match";
import { config } from "../src/core/config";
import { spawn } from "../src/core/deploy";
import { castSkill, applyHit } from "../src/core/combat";
import { byId, build } from "../src/core/cards";
import * as evolution from "../src/core/evolution";
import { MOVE_STATUS } from "../src/core/status";
import * as skills from "../src/core/skills";

/** A caster and something to aim at, both awake. */
function pair(id: string) {
  const m = new Match(5);
  const u = spawn(m, byId(id)!, config.PLAYER, 190, 400);
  u.spawning = 0;
  const foe = spawn(m, byId("charmander")!, config.ENEMY, 190, 380);
  foe.spawning = 0;
  return { m, u, foe };
}

describe("a move does what the move is", () => {
  it("Teleport moves the caster, and toward the enemy", () => {
    const { m, u, foe } = pair("abra");
    const before = u.y;
    castSkill(m, u, foe, 1);
    // The player marches up the board, so forward is a smaller y. Getting this
    // sign wrong -- which a `side === 0` test does, since PLAYER is 1 -- sends
    // it backwards into its own half.
    expect(u.y).toBeLessThan(before);
    expect(before - u.y).toBeCloseTo(64, 0);
  });

  it("Teleport does not throw the caster off the board", () => {
    const { m, u, foe } = pair("abra");
    u.y = 10;
    castSkill(m, u, foe, 1);
    expect(u.y).toBeGreaterThanOrEqual(0);
    expect(u.y).toBeLessThanOrEqual(config.arenaHeight);
  });

  it("Wish heals, and cannot overheal", () => {
    const { m, u, foe } = pair("togepi");
    u.hp = u.maxHP * 0.5;
    castSkill(m, u, foe, 1);
    expect(u.hp).toBeGreaterThan(u.maxHP * 0.5);

    u.hp = u.maxHP;
    castSkill(m, u, foe, 1);
    expect(u.hp).toBe(u.maxHP);
  });

  it("Agility raises speed, Defense Curl raises armour instead", () => {
    const a = pair("rattata");
    const speed = a.u.speed;
    castSkill(a.m, a.u, a.foe, 1);
    expect(a.u.speed).toBeGreaterThan(speed);

    const b = pair("bronzor");
    const { speed: bSpeed, def } = { speed: b.u.speed, def: b.u.def ?? 0 };
    castSkill(b.m, b.u, b.foe, 1);
    expect(b.u.speed).toBe(bSpeed);
    expect(b.u.def ?? 0).toBeGreaterThan(def);
  });

  it("a non-damage move deals no damage", () => {
    // The whole point: Teleport used to take a chunk out of whatever it was
    // aimed at, because the fallback is damage.
    const { m, u, foe } = pair("abra");
    const hp = foe.hp;
    castSkill(m, u, foe, 1);
    expect(foe.hp).toBe(hp);
  });

  it("Happy Hour pays elixir, not damage, and respects the cap", () => {
    // PAC's prize money in our currency. There is no money here, but there is
    // a resource you spend, and that is the same thing.
    const { m, u, foe } = pair("eevee");
    m.elixir[config.PLAYER] = 4;
    const hp = foe.hp;
    castSkill(m, u, foe, 1);
    expect(m.elixir[config.PLAYER]).toBe(5);
    expect(foe.hp).toBe(hp);

    m.elixir[config.PLAYER] = config.elixirMax;
    castSkill(m, u, foe, 1);
    expect(m.elixir[config.PLAYER]).toBe(config.elixirMax);
  });

  it("a real attack still hits", () => {
    const { m, u, foe } = pair("charmander");
    const hp = foe.hp;
    castSkill(m, u, foe, 1);
    expect(foe.hp).toBeLessThan(hp);
  });
});

describe("Eevee's branches are actually different", () => {
  it("only the base form keeps Happy Hour, and it means elixir now", () => {
    // The branches used to share it, so eight creatures cast one effect.
    for (const b of evolution.branchesFor("eevee") ?? []) {
      expect(build(b).skill).not.toBe("HAPPY_HOUR");
    }
    expect(build("eevee").skill).toBe("HAPPY_HOUR");
    expect(skills.MOVE_EFFECT.HAPPY_HOUR?.kind).toBe("elixir");
  });

  it("every branch carries a different status", () => {
    const branches = evolution.branchesFor("eevee") ?? [];
    expect(branches.length).toBeGreaterThan(4);

    const kinds = branches.map((b) => MOVE_STATUS[build(b).skill]?.kind);
    for (const k of kinds) expect(k).toBeDefined();
    // Distinct, or the choice is cosmetic again.
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("moves powered by something other than attack", () => {
  it("uses PAC's formula, not a generic fallback", () => {
    // All six were treated as "attack x a constant". None of them are.
    expect(skills.POWERED.IRON_TAIL.from).toBe("def");
    expect(skills.POWERED.ROLLOUT.from).toBe("def");
    expect(skills.POWERED.BODY_SLAM.from).toBe("maxHP");
    expect(skills.POWERED.FOUL_PLAY.from).toBe("targetAttack");
    expect(skills.POWERED.METEOR_MASH.from).toBe("attack");
    expect(skills.POWERED.WOOD_HAMMER.from).toBe("attack");
  });

  it("Iron Tail hits for the caster's own defence", () => {
    const { m, u, foe } = pair("onix");
    u.def = 20;
    const hard = (() => { const hp = foe.hp; castSkill(m, u, foe, 1); return hp - foe.hp; })();
    const b = pair("onix");
    b.u.def = 2;
    const soft = (() => { const hp = b.foe.hp; castSkill(b.m, b.u, b.foe, 1); return hp - b.foe.hp; })();
    expect(hard).toBeGreaterThan(soft);
  });

  it("Body Slam hits for a share of the caster's own health", () => {
    const { m, u, foe } = pair("snorlax");
    const hp = foe.hp;
    castSkill(m, u, foe, 1);
    // Snorlax is the biggest body on the roster; the move should reflect that.
    expect(hp - foe.hp).toBeGreaterThan(u.maxHP * 0.2);
  });

  it("Rollout raises its own defence, so each cast hits harder than the last", () => {
    const { m, u, foe } = pair("sandshrew");
    const first = (() => { const hp = foe.hp; castSkill(m, u, foe, 1); return hp - foe.hp; })();
    const second = (() => { const hp = foe.hp; castSkill(m, u, foe, 1); return hp - foe.hp; })();
    expect(second).toBeGreaterThan(first);   // the ramp, with no counter anywhere
  });

  it("no roster move is forced physical -- PAC calls them all special", () => {
    expect((skills as Record<string, unknown>).PHYSICAL_MOVES).toBeUndefined();
  });
});

describe("Foul Play strikes with the target's attack", () => {
  it("hits harder against a strong target than a weak one", () => {
    const hit = (targetDamage: number) => {
      const { m, u, foe } = pair("sandile");
      foe.damage = targetDamage;
      foe.def = 0; foe.speDef = 0;
      const hp = foe.hp;
      castSkill(m, u, foe, 1);
      return hp - foe.hp;
    };
    // The caster is unchanged between these two; only what it is fighting is.
    expect(hit(80)).toBeGreaterThan(hit(10));
  });

  it("falls back to its own damage against a tower, which has no attack to borrow", () => {
    const { m, u } = pair("sandile");
    const tower = m.towers.find((t) => t.side !== u.side)!;
    const hp = tower.hp;
    castSkill(m, u, tower, 1);
    expect(tower.hp).toBeLessThan(hp);
  });
});

describe("the moves left as damage were decided, not forgotten", () => {
  it("records why", () => {
    for (const m of ["TRANSFORM"]) {
      expect(skills.DELIBERATELY_DAMAGE.has(m)).toBe(true);
      expect(skills.MOVE_EFFECT[m]).toBeUndefined();
    }
  });
});

describe("Electrify shields, rather than retyping anything", () => {
  it("shields itself when there is no ally, and deals no damage", () => {
    // The normal case for a win condition: it runs ahead of everything.
    const { m, u, foe } = pair("yamper");
    const hp = foe.hp;
    castSkill(m, u, foe, 1);
    expect(u.shield).toBeGreaterThan(0);
    expect(foe.hp).toBe(hp);
  });

  it("prefers the strongest ally standing with it", () => {
    const m = new Match(5);
    const y = spawn(m, byId("yamper")!, config.PLAYER, 190, 400); y.spawning = 0;
    const tank = spawn(m, byId("snorlax")!, config.PLAYER, 195, 400); tank.spawning = 0;
    const foe = spawn(m, byId("charmander")!, config.ENEMY, 190, 380); foe.spawning = 0;

    castSkill(m, y, foe, 1);
    expect(tank.shield).toBeGreaterThan(0);
    expect(y.shield).toBe(0);
  });

  it("soaks damage before health, and lets the overflow through", () => {
    const { m, u, foe } = pair("yamper");
    castSkill(m, u, foe, 1);
    const shield = u.shield;
    const hp = u.hp;

    applyHit(m, u, 5, 1, foe);
    expect(u.hp).toBe(hp);                       // absorbed entirely
    expect(u.shield).toBeLessThan(shield);

    applyHit(m, u, 10_000, 1, foe);
    expect(u.shield).toBe(0);                    // drained, not negative
    expect(u.hp).toBeLessThan(hp);               // and the rest landed
  });

  it("a shield never becomes negative health", () => {
    const { m, u, foe } = pair("yamper");
    castSkill(m, u, foe, 1);
    applyHit(m, u, 1, 1, foe);
    expect(u.shield).toBeGreaterThanOrEqual(0);
  });
});

describe("a blink lands somewhere legal", () => {
  it("never finishes inside a tower", () => {
    // Teleport ignores everything between here and there, which is the point.
    // It must not ignore where it arrives: Abra used to land in the stonework,
    // caught by the "keeps ground units out of towers" invariant on two of six
    // matches rather than by anything here.
    const m = new Match(5);
    const foe = spawn(m, byId("charmander")!, config.ENEMY, 190, 200);
    foe.spawning = 0;

    for (const t of m.towers) {
      const u = spawn(m, byId("abra")!, config.PLAYER, t.x, t.y + 70);
      u.spawning = 0;
      castSkill(m, u, foe, 1);

      const half = config.towerSize[t.kind] / 2;
      const box = config.towerBox[t.kind];
      const dy = u.y - t.y;
      const inside = Math.abs(u.x - t.x) < half && dy > -box.up && dy < box.down;
      expect(inside).toBe(false);
    }
  });
});
