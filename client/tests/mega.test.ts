import { describe, it, expect } from "vitest";
import { Match } from "../src/core/match";
import { spawn } from "../src/core/deploy";
import { config } from "../src/core/config";
import * as cards from "../src/core/cards";
import * as evolution from "../src/core/evolution";
import * as mega from "../src/core/mega";

/** A match whose first deck slot is `id`, with a unit of it already fighting. */
function withSlotOne(id: string, x = 190, y = 400) {
  const m = new Match(1);
  const card = cards.build(id)!;
  m.megaPick[config.PLAYER] = card;
  m.elixir[config.PLAYER] = 10;
  const u = spawn(m, card, config.PLAYER, x, y);
  u.spawning = 0;
  return { m, u, card };
}

describe("mega evolution", () => {
  it("offers every card that has real Mega art, and nothing else", () => {
    // 36 Megas plus Kyogre and Groudon's Primals.
    expect(Object.keys(mega.MEGA)).toHaveLength(38);
    for (const [base, form] of Object.entries(mega.MEGA)) {
      expect(cards.build(base), base).toBeDefined();
      expect(cards.build(form), form).toBeDefined();
    }
  });

  it("is not reachable by ordinary evolution", () => {
    // PAC's data had steelix evolve into its Mega, which would have made one
    // of the eleven free while the rest cost elixir.
    for (const form of mega.MEGA_FORMS) {
      for (const base of Object.keys(mega.MEGA)) {
        expect(evolution.chainOf(base), `${base} -> ${form}`).not.toContain(form);
      }
    }
  });

  it("turns the slot-one unit into its Mega and charges for it", () => {
    const { m, u } = withSlotOne("charizard");
    const before = { hp: u.maxHP, dmg: u.damage, elixir: m.elixir[config.PLAYER] };

    const out = mega.mega(m, config.PLAYER);
    expect(out).toBe(u);
    expect(u.mega).toBe(true);
    expect(u.card.id).toBe("megacharizard");
    expect(u.maxHP).toBeGreaterThan(before.hp);
    expect(u.damage).toBeGreaterThan(before.dmg);
    expect(m.elixir[config.PLAYER]).toBe(before.elixir - config.megaCost);
  });

  it("keeps the damage already taken rather than healing", () => {
    const { m, u } = withSlotOne("charizard");
    u.hp = Math.round(u.maxHP / 2);

    mega.mega(m, config.PLAYER);
    const fraction = u.hp / u.maxHP;
    expect(fraction).toBeGreaterThan(0.45);
    expect(fraction).toBeLessThan(0.55);
  });

  it("refuses without the elixir", () => {
    const { m } = withSlotOne("charizard");
    m.elixir[config.PLAYER] = config.megaCost - 0.1;
    expect(mega.canMega(m, config.PLAYER)).toBe(false);
    expect(mega.mega(m, config.PLAYER)).toBeUndefined();
  });

  it("refuses when the slot-one card is not on the board", () => {
    const m = new Match(1);
    m.megaPick[config.PLAYER] = cards.build("charizard")!;
    m.elixir[config.PLAYER] = 10;
    expect(mega.canMega(m, config.PLAYER)).toBe(false);
  });

  it("refuses when slot one cannot Mega at all", () => {
    const { m } = withSlotOne("pikachu");
    expect(mega.canMega(m, config.PLAYER)).toBe(false);
  });

  it("qualifies a base card by what it evolves into", () => {
    // The deck holds Charmander, never Charizard -- seven of the eleven are
    // only reached by evolving, so asking about the slot's own id would offer
    // the button to four cards and refuse the other seven.
    for (const base of ["charmander", "gastly", "abra", "onix", "snorunt", "riolu", "larvitar"]) {
      expect(mega.canEverMega(cards.build(base)), base).toBe(true);
    }
    expect(mega.canEverMega(cards.build("pikachu"))).toBe(false);
  });

  it("Megas an evolved unit while the deck still holds the base card", () => {
    const m = new Match(1);
    m.megaPick[config.PLAYER] = cards.build("charmander")!;
    m.elixir[config.PLAYER] = 10;
    const grown = spawn(m, cards.build("charizard")!, config.PLAYER, 190, 400);
    grown.spawning = 0;

    expect(mega.canMega(m, config.PLAYER)).toBe(true);
    expect(mega.mega(m, config.PLAYER)).toBe(grown);
    expect(grown.card.id).toBe("megacharizard");
  });

  it("will not Mega a form this deck slot cannot reach", () => {
    const m = new Match(1);
    m.megaPick[config.PLAYER] = cards.build("gastly")!;   // reaches Gengar
    m.elixir[config.PLAYER] = 10;
    const other = spawn(m, cards.build("charizard")!, config.PLAYER, 190, 400);
    other.spawning = 0;
    expect(mega.canMega(m, config.PLAYER)).toBe(false);
  });

  it("allows only one Mega per side at a time", () => {
    const { m } = withSlotOne("charizard");
    expect(mega.mega(m, config.PLAYER)).toBeDefined();

    // A second arrives after the first has Mega'd: the Mega no longer counts
    // as a candidate, so this is one on the board -- but the side already has
    // its Mega, so the button stays dark.
    const second = spawn(m, cards.build("charizard")!, config.PLAYER, 200, 420);
    second.spawning = 0;
    m.elixir[config.PLAYER] = 10;
    expect(mega.canMega(m, config.PLAYER)).toBe(false);
    expect(second.mega).toBeFalsy();
  });

  it("goes dark when two of the card are on the board", () => {
    // No way to say which one was meant, and guessing spends three elixir on a
    // unit the player did not choose.
    const { m, u } = withSlotOne("charizard", 190, 400);
    expect(mega.megaTarget(m, config.PLAYER)).toBe(u);

    const second = spawn(m, cards.build("charizard")!, config.PLAYER, 190, 200);
    second.spawning = 0;
    expect(mega.megaTarget(m, config.PLAYER)).toBeUndefined();
    expect(mega.canMega(m, config.PLAYER)).toBe(false);
  });

  it("comes back once only one is left", () => {
    const { m, u } = withSlotOne("charizard", 190, 400);
    const second = spawn(m, cards.build("charizard")!, config.PLAYER, 190, 200);
    second.spawning = 0;
    expect(mega.canMega(m, config.PLAYER)).toBe(false);

    second.dead = true;
    expect(mega.megaTarget(m, config.PLAYER)).toBe(u);
    expect(mega.canMega(m, config.PLAYER)).toBe(true);
  });

  it("only the final form can Mega", () => {
    for (const [id, allowed] of [["charmander", false], ["charmeleon", false],
                                 ["charizard", true]] as [string, boolean][]) {
      const m = new Match(1);
      m.megaPick[config.PLAYER] = cards.build("charmander")!;
      m.elixir[config.PLAYER] = 10;
      const u = spawn(m, cards.build(id)!, config.PLAYER, 190, 400);
      u.spawning = 0;
      expect(mega.canMega(m, config.PLAYER), id).toBe(allowed);
    }
  });

  it("announces itself so the screen can react", () => {
    const { m } = withSlotOne("charizard");
    mega.mega(m, config.PLAYER);
    expect(m.events.some((e) => e.type === "mega")).toBe(true);
  });
});

describe("the Mega slot survives the shuffle", () => {
  it("is the deck's first card as built, not as dealt", () => {
    // A match shuffles its deck, so reading slot one off `match.deck` gave a
    // different card every match -- the button lit for whatever the shuffle
    // put first, which is not a choice the player made.
    const deck = [cards.build("charmander")!, ...cards.ALL.slice(0, 5)];
    for (let seed = 1; seed <= 20; seed++) {
      const m = new Match({ rng: () => (seed * 9301 % 233280) / 233280, playerDeck: deck });
      expect(m.megaPick[config.PLAYER]?.id).toBe("charmander");
    }
  });
});
