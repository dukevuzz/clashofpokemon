/**
 * Every creature, checked one at a time.
 *
 * `test.each` over the roster rather than a loop inside one test, because the
 * failure message is the point: "Snorlax deploy delay is playable" tells you
 * what to open. A single test that loops and asserts tells you only that
 * something, somewhere, is wrong -- which is what tools/selfcheck.ts does and
 * why this exists beside it rather than instead of it.
 *
 * Selfcheck still owns the long simulation sweeps: 700-match pacing runs and
 * 3.9-million-sample river scans do not belong in a test suite anyone is
 * expected to run before a commit. This file owns everything that can be
 * decided by looking at one card.
 */

import { describe, expect, test } from "vitest";
import * as cards from "../src/core/cards";
import * as evolution from "../src/core/evolution";
import * as status from "../src/core/status";
import * as tiers from "../src/core/tiers";
import { config } from "../src/core/config";
import { SPECIES, typesOf } from "../src/core/species";
import { SHEETS } from "../src/data/sheets";
import ATLAS from "../public/atlas/index.json" with { type: "json" };

/** Base forms plus every form a match can evolve them into. */
const ALL_FORMS = (() => {
  const out: cards.Card[] = [];
  const seen = new Set<string>();
  for (const c of cards.ALL) {
    // chainOf includes the species itself, so this is every form, not the
    // base plus its descendants.
    for (const id of evolution.chainOf(c.id)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const built = id === c.id ? c : cards.build(id, c);
      if (built) out.push(built);
    }
  }
  return out;
})();

const named = (c: cards.Card) => c.name;

describe("every playable form", () => {
  test.each(ALL_FORMS.map((c) => [named(c), c] as const))(
    "%s has usable stats", (_name, c) => {
      expect(c.hp).toBeGreaterThan(0);
      expect(c.damage).toBeGreaterThan(0);
      expect(c.elixir).toBeGreaterThanOrEqual(1);
      expect(c.elixir).toBeLessThanOrEqual(8);
      expect(c.count).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(c.hp)).toBe(true);
      expect(Number.isFinite(c.damage)).toBe(true);
      // Zero is legal and means a building; negative is never legal.
      expect(c.speed).toBeGreaterThanOrEqual(0);
      // It must notice at least as far as it can hit, or it stands next to
      // something it is able to kill and does nothing.
      expect(c.aggro).toBeGreaterThanOrEqual(c.range);
    },
  );

  test.each(ALL_FORMS.map((c) => [named(c), c] as const))(
    "%s can be drawn", (_name, c) => {
      const sheet = SHEETS[c.sheet];
      expect(sheet, `no sheet for ${c.sheet}`).toBeTruthy();
      // Idle is the universal fallback in ui/sprites.ts; without it a creature
      // resolves to undefined and renders as nothing at all.
      expect(sheet.anims.Idle, `${c.name} has no Idle`).toBeTruthy();
      expect(sheet.anims.Walk, `${c.name} has no Walk`).toBeTruthy();
    },
  );

  test.each(ALL_FORMS.map((c) => [named(c), c] as const))(
    "%s arrives in a playable time", (_name, c) => {
      // Zero removes the reaction window the delay exists for; too long is
      // indistinguishable from the card not working.
      expect(c.deployDelay).toBeGreaterThanOrEqual(0.5);
      expect(c.deployDelay).toBeLessThanOrEqual(2.5);
    },
  );

  test.each(ALL_FORMS.map((c) => [named(c), c] as const))(
    "%s has a type the chart knows", (_name, c) => {
      expect(c.types.length).toBeGreaterThan(0);
      for (const t of c.types) expect(t).toBe(t.toUpperCase());
    },
  );
});

describe("the animations a card's own traits require", () => {
  // Need-based. Converting a species is not idempotent against the converter's
  // default anim list -- `Shoot` and `Hop` were added to it long after most
  // sheets were made -- so sheets go stale silently. Demanding every anim on
  // every sheet fails 83 of 125 for animations nothing plays; demanding the
  // ones a card actually uses catches the faults that reached players.
  const leapers = cards.ALL.filter((c) => c.jumpsRiver || c.delivery);
  test.each(leapers.map((c) => [named(c), c] as const))(
    "%s leaps or is delivered, so it has Hop", (_name, c) => {
      expect(SHEETS[c.sheet].anims.Hop).toBeTruthy();
    },
  );

  const tunnellers = cards.ALL.filter((c) => c.delivery === "tunnel");
  test.each(tunnellers.map((c) => [named(c), c] as const))(
    "%s tunnels, so it has DigIn", (_name, c) => {
      expect(SHEETS[c.sheet].anims.DigIn).toBeTruthy();
    },
  );
});

describe("evolution", () => {
  test.each(cards.ALL.map((c) => [named(c), c] as const))(
    "%s's chain is buildable end to end", (_name, c) => {
      let prev = c;
      for (const form of evolution.chainOf(c.id).filter((f) => f !== c.id)) {
        const built = cards.build(form, prev);
        expect(built, `${c.name} -> ${form} does not build`).toBeTruthy();
        prev = built!;
      }
    },
  );

  test.each(cards.ALL.map((c) => [named(c), c] as const))(
    "%s never loses what makes it itself", (_name, c) => {
      let prev = c;
      for (const form of evolution.chainOf(c.id).filter((f) => f !== c.id)) {
        const next = cards.build(form, prev)!;
        // Each of these has been lost to a bug at least once: delivery when
        // `build` read FLAVOUR instead of the parent, bodies when evolution
        // shrank the count by 0.7 a stage.
        if (prev.delivery) expect(next.delivery).toBe(prev.delivery);
        if (prev.flying) expect(next.flying).toBe(true);
        expect(next.count).toBe(prev.count);
        prev = next;
      }
    },
  );

  test("a chain never revisits a form", () => {
    for (const c of cards.ALL) {
      const chain = evolution.chainOf(c.id);
      expect(new Set(chain).size, `${c.name}: ${chain.join(">")}`).toBe(chain.length);
    }
  });

  test("an evolution costs exactly the step more", () => {
    for (const c of cards.ALL) {
      let prev = c;
      for (const form of evolution.chainOf(c.id).filter((f) => f !== c.id)) {
        const next = cards.build(form, prev)!;
        // Clamped at 8, so the step is the increase *or* the card is at the cap.
        expect(next.elixir === Math.min(8, prev.elixir + 2)).toBe(true);
        prev = next;
      }
    }
  });
});

describe("attack speed", () => {
  test("it is no longer one number for the whole roster", () => {
    // It was 1.1 for all 49 cards, which meant a Yamper at speed 77 swung at
    // exactly the rate of a Snorlax at 35. Basic attacks are 91% of all damage,
    // so this was the largest stat in the game being thrown away.
    expect(new Set(cards.ALL.map((c) => c.attackRate)).size).toBeGreaterThan(10);
  });

  test("faster species swing sooner, without exception", () => {
    const rows = cards.ALL
      .map((c) => ({ speed: SPECIES[c.id].speed, rate: c.attackRate }))
      .sort((a, b) => a.speed - b.speed);
    for (let i = 1; i < rows.length; i++) {
      // Monotonic: a slower creature must never attack faster than a quicker
      // one, whatever the curve is retuned to.
      if (rows[i].speed > rows[i - 1].speed) {
        expect(rows[i].rate).toBeLessThanOrEqual(rows[i - 1].rate);
      }
    }
  });

  test("every rate stays inside a playable band", () => {
    for (const c of cards.ALL) {
      expect(c.attackRate, c.name).toBeGreaterThanOrEqual(0.45);
      expect(c.attackRate, c.name).toBeLessThanOrEqual(1.9);
    }
  });

  test("the median card is unchanged from the flat rate it replaced", () => {
    // The curve is anchored so retuning it cannot silently shift the whole
    // roster: only the ends should move.
    expect(cards.attackRateFor(50)).toBeCloseTo(1.1, 2);
  });
});

describe("pricing", () => {
  test("costOf is deterministic", () => {
    const once = cards.ALL.map((c) => c.elixir);
    const twice = cards.ALL.map((c) =>
      cards.costOf(SPECIES[c.id], c.rarity, c.count, {
        wincon: !c.targets.includes("troop"),
        jumps: c.jumpsRiver,
        flying: c.flying,
        // Every pricing input has to be listed here or this test drifts into
        // asserting that costOf agrees with a *subset* of itself. Adding
        // `anywhere` -- the premium for tunnelling or being thrown -- broke it
        // exactly as it should have.
        anywhere: cards.arrivesAnywhere(c.delivery),
      }),
    );
    expect(twice).toEqual(once);
  });

  test("every species in the data prices inside the bar", () => {
    const bad: string[] = [];
    for (const [id, info] of Object.entries(SPECIES)) {
      const cost = cards.costOf(info, tiers.rarityOf(id), 1, {});
      if (cost < 1 || cost > 8) bad.push(`${id}:${cost}`);
    }
    expect(bad).toEqual([]);
  });

  test("nothing pays the win-condition premium unless it skips troops", () => {
    // The premium priced a behaviour the targets refactor deleted, and eleven
    // cards paid it for months. Both now read the same field.
    for (const c of cards.ALL) {
      const charged = !c.targets.includes("troop");
      if (charged) expect(c.hp).toBeGreaterThan(config.towerDamage.side * 3);
    }
  });

  test("the curve actually spreads", () => {
    expect(new Set(cards.ALL.map((c) => c.elixir)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("status moves", () => {
  test("every mapped move belongs to a real ability", () => {
    for (const skill of Object.keys(status.MOVE_STATUS)) {
      expect(skill).toBe(skill.toUpperCase());
    }
  });

  test("chances and durations are sane", () => {
    for (const [skill, e] of Object.entries(status.MOVE_STATUS)) {
      expect(e.chance, skill).toBeGreaterThan(0);
      expect(e.chance, skill).toBeLessThanOrEqual(1);
      expect(e.seconds, skill).toBeGreaterThan(0);
      expect(e.seconds, skill).toBeLessThanOrEqual(8);
    }
  });

  test("every status kind is reachable from some card", () => {
    const reachable = new Set(
      cards.ALL.map((c) => status.MOVE_STATUS[c.skill]?.kind).filter(Boolean),
    );
    const all: status.StatusKind[] = [
      "paralysis", "flinch", "confusion", "armorBreak",
      "burn", "poison", "sleep", "freeze", "silence", "charm",
    ];
    // A kind nothing can cause is dead code that reads as a feature.
    expect([...all].filter((k) => !reachable.has(k))).toEqual([]);
  });
});

describe("the roster as a whole", () => {
  test("no two cards are the same species", () => {
    const ids = cards.ALL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a base form is never also somebody else's evolution", () => {
    // Otherwise one chain can appear twice in a deck, once as its own card and
    // once as something another card grows into.
    for (const c of cards.ALL) {
      const others = cards.ALL.filter((o) => o.id !== c.id);
      const reachable = new Set(others.flatMap((o) =>
        evolution.chainOf(o.id).filter((f) => f !== o.id)));
      expect(reachable.has(c.id), `${c.name} is reachable from another card`).toBe(false);
    }
  });

  test("a FLYING-typed card actually flies", () => {
    for (const c of cards.ALL) {
      if (typesOf(c.sheet).includes("FLYING")) expect(c.flying, c.name).toBe(true);
    }
  });
});

describe("the packed atlas agrees with the sheet it came from", () => {
  // The row index is 1-based in sheets.json and 0-based in the image the
  // converter pastes. The old renderer compensated with `(row - 1) * cols`;
  // the packer initially did not, which shifted every animation onto the next
  // (anim, direction) pair of the layout. Every creature faced the wrong way
  // and no check could see it, because both halves were internally consistent.
  test("every animation's frames exist in the index", () => {
    const missing: string[] = [];
    for (const [name, sheet] of Object.entries(SHEETS)) {
      const entry = (ATLAS as Record<string, { f: Record<string, number[]> }>)[name];
      if (!entry) continue;
      for (const [action, dirs] of Object.entries(sheet.anims)) {
        for (const [dir, info] of Object.entries(dirs)) {
          for (let i = 0; i < info.frames; i++) {
            const key = `${action}-${dir}-${i}`;
            if (!entry.f[key]) missing.push(`${name}:${key}`);
          }
        }
      }
    }
    expect(missing.slice(0, 10)).toEqual([]);
  });

  test("no animation's row runs past the end of its sheet", () => {
    const bad: string[] = [];
    for (const [name, sheet] of Object.entries(SHEETS)) {
      for (const [action, dirs] of Object.entries(sheet.anims)) {
        for (const [dir, info] of Object.entries(dirs)) {
          // 1-based. A packer that forgets this reads one row too far, and the
          // last animation of every sheet falls off the bottom.
          if (info.row < 1 || info.row > sheet.rows) bad.push(`${name}:${action}-${dir}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
