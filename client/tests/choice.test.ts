/**
 * Answering a branch offer, and every way of getting it wrong.
 *
 * These paths matter more than their size suggests. The match no longer stops
 * to ask, so an offer can still be open when a second one is raised -- and an
 * answer that named a position in a list instead of a card would then answer
 * the wrong question, permanently, with nothing on screen to say so. A branch
 * cannot be taken back.
 *
 * Every refusal below is a `return false` that would be easy to delete during
 * a refactor and impossible to notice afterwards.
 */

import { describe, it, expect } from "vitest";
import { Match } from "../src/core/match";
import { config } from "../src/core/config";
import { byId } from "../src/core/cards";
import * as hand from "../src/core/hand";
import * as evolution from "../src/core/evolution";

/** A deterministic match holding Eevee, so a replacement has somewhere to land. */
function withOfferFor(eevee: ReturnType<typeof byId>) {
  let seed = 42;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return new Match({
    rng, bot: {}, shuffle: false,
    playerDeck: [eevee!, ...["snorlax", "voltorb", "machop", "geodude", "pikachu"]
      .map((id) => byId(id)!)],
  });
}

/** A match with an Eevee offer standing, for the side that must answer it. */
function withOffer() {
  const eevee = byId("eevee")!;
  const m = new Match({
    playerDeck: [eevee, ...["snorlax", "voltorb", "machop", "geodude", "pikachu"]
      .map((id) => byId(id)!)],
    shuffle: false,
    // Neither side is a bot, so an offer is raised rather than auto-taken.
    bot: {},
  });
  const needed = evolution.playsNeeded(eevee)!;
  for (let i = 0; i < needed; i++) {
    hand.countPlay(m, config.PLAYER, eevee);
  }
  const offer = m.pendingChoice[config.PLAYER];
  return { m, offer, eevee };
}

describe("a branch offer is raised for a side with nobody to ask", () => {
  it("is offered rather than taken when the side is a person", () => {
    const { offer } = withOffer();
    expect(offer).toBeDefined();
    expect(offer!.options.length).toBeGreaterThan(1);
    expect(offer!.id).toMatch(/^c\d+$/);
  });

  it("is taken at random for a side that is a bot", () => {
    const eevee = byId("eevee")!;
    const m = new Match({ bot: { [config.ENEMY]: true } });
    const needed = evolution.playsNeeded(eevee)!;
    for (let i = 0; i < needed; i++) hand.countPlay(m, config.ENEMY, eevee);
    expect(m.pendingChoice[config.ENEMY]).toBeUndefined();
  });

  it("is not raised when the committed branch is among those offered", () => {
    // An offer is three of Eevee's eight branches, drawn at random, and a
    // pre-commitment is honoured only if the chosen one is in that three.
    //
    // Which means committing does NOT reliably avoid the prompt: a player who
    // picked Vaporeon in the deck builder is still asked whenever Vaporeon is
    // not offered. Asserting the behaviour that exists rather than the one the
    // feature's name implies -- see the note in the report.
    const eevee = byId("eevee")!;
    const needed = evolution.playsNeeded(eevee)!;

    // Which three are offered depends on the rng, so the same one is used
    // twice: once to learn what is on offer, once with a commitment to it.
    // Eevee has to actually be in the deck, or replaceCard finds nothing to
    // swap and the branch is chosen without ever arriving.
    const build = () => withOfferFor(eevee);
    const asked = build();
    for (let i = 0; i < needed; i++) hand.countPlay(asked, config.PLAYER, eevee);
    const wanted = asked.pendingChoice[config.PLAYER]!.options[1].id;

    const committed = build();
    committed.preferredBranch[config.PLAYER] = wanted;
    for (let i = 0; i < needed; i++) hand.countPlay(committed, config.PLAYER, eevee);

    expect(committed.pendingChoice[config.PLAYER]).toBeUndefined();
    expect(committed.deck[config.PLAYER].map((c) => c.id)).toContain(wanted);
  });

  it("names offers in sequence, so two can be told apart", () => {
    const m = new Match({ bot: {} });
    expect([m.nextChoiceId(), m.nextChoiceId()]).toEqual(["c1", "c2"]);
  });
});

describe("answering it", () => {
  it("takes the branch that was named", () => {
    const { m, offer } = withOffer();
    const pick = offer!.options[1].id;
    expect(m.takeChoice(config.PLAYER, offer!.id, pick)).toBe(true);
    expect(m.deck[config.PLAYER].map((c) => c.id)).toContain(pick);
    expect(m.pendingChoice[config.PLAYER]).toBeUndefined();
  });

  it("refuses an answer when nothing was asked", () => {
    const m = new Match({ bot: {} });
    expect(m.takeChoice(config.PLAYER, "c1", "vaporeon")).toBe(false);
  });

  it("refuses an answer to a different offer", () => {
    // The stale reply. Two offers can be open because the match does not stop,
    // and answering the wrong one is permanent.
    const { m, offer } = withOffer();
    expect(m.takeChoice(config.PLAYER, "c999", offer!.options[0].id)).toBe(false);
    expect(m.pendingChoice[config.PLAYER]).toBeDefined();
  });

  it("refuses a card the offer did not contain", () => {
    const { m, offer } = withOffer();
    expect(m.takeChoice(config.PLAYER, offer!.id, "charizard")).toBe(false);
    expect(m.pendingChoice[config.PLAYER]).toBeDefined();
  });

  it("refuses an answer from the wrong side", () => {
    // The offer belongs to one seat. In a real match the other player must not
    // be able to choose somebody else's evolution.
    const { m, offer } = withOffer();
    expect(m.takeChoice(config.ENEMY, offer!.id, offer!.options[0].id)).toBe(false);
    expect(m.pendingChoice[config.PLAYER]).toBeDefined();
  });

  it("cannot be answered twice", () => {
    const { m, offer } = withOffer();
    expect(m.takeChoice(config.PLAYER, offer!.id, offer!.options[0].id)).toBe(true);
    expect(m.takeChoice(config.PLAYER, offer!.id, offer!.options[1].id)).toBe(false);
  });
});

describe("how far a card is from evolving", () => {
  it("counts plays against what the card needs", () => {
    const m = new Match({ bot: {} });
    const charmander = byId("charmander")!;
    const needed = evolution.playsNeeded(charmander)!;
    expect(m.evolutionProgress(config.PLAYER, charmander))
      .toEqual({ done: 0, needed });

    hand.countPlay(m, config.PLAYER, charmander);
    expect(m.evolutionProgress(config.PLAYER, charmander)!.done).toBe(1);
  });

  it("says nothing for a card with nowhere to go", () => {
    // A terminal card has no progress to show, and a bar at zero forever would
    // read as a card that never grows rather than one that cannot.
    const m = new Match({ bot: {} });
    const terminal = byId("snorlax")!;
    if (!evolution.playsNeeded(terminal)) {
      expect(m.evolutionProgress(config.PLAYER, terminal)).toBeUndefined();
    }
  });
});
