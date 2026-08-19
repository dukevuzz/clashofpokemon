/** The hand, the deck, and what a card becomes. */

import * as cards from "./cards";
import { type Side } from "./config";
import * as evolution from "./evolution";
import type { Card } from "./cards";
import type { Match } from "./match";


/** Cycle the deck, skipping anything already in the hand. */
export function drawFromDeck(
  match: Match,
  side: Side, slot: number) {
  const deck = match.deck[side];
  for (let n = 0; n < deck.length; n++) {
    const idx = (match.drawIndex[side] + n) % deck.length;
    const card = deck[idx];
    if (!match.hand[side].includes(card)) {
      match.hand[side][slot] = card;
      match.drawIndex[side] = (idx + 1) % deck.length;
      return;
    }
  }
}

/** What this card costs right now. */
export function costOf(
  match: Match,
  side: Side, card: Card): number {
  if (!card.copies) return card.elixir;
  const target = match.lastPlayed[side];
  return target ? target.elixir + 1 : Infinity;
}

/** What a copy card would actually put down, if played now. */
export function copyTarget(
  match: Match,
  side: Side, card: Card): Card | undefined {
  return card.copies ? match.lastPlayed[side] : undefined;
}

/** Playing a card is what advances it. */
export function countPlay(
  match: Match,
  side: Side, card: Card) {
  const needed = evolution.playsNeeded(card);
  if (!needed) return;

  const plays = match.plays[side];
  plays[card.id] = (plays[card.id] ?? 0) + 1;
  if (plays[card.id] < needed) return;

  // A branching species offers a choice instead of evolving on its own.
  const offer = evolution.offerFor(card.id, match.rng);
  if (offer && offer.length > 0) {
    plays[card.id] = 0;
    const slot = match.hand[side].indexOf(card);

    // Committed ahead of time in the deck builder: no interruption at all.
    const want = match.preferredBranch[side];
    const committed = want && offer.find((c) => c.id === want);
    if (committed) {
      match.note("choice.precommitted", "local", side, { to: committed.id });
      replaceCard(match, side, card, committed);
      return;
    }
    // A side nobody is watching answers itself. This used to read
    // `side === config.PLAYER`, which was the same thing while exactly one
    // side was human and silently wrong the moment two are.
    if (match.bot[side]) {
      const pick = offer[Math.floor(match.rng() * offer.length)];
      match.note("choice.auto", "local", side, { to: pick.id });
      replaceCard(match, side, card, pick);
      return;
    }
    const id = match.nextChoiceId();
    match.pendingChoice[side] = { id, slot, from: card, options: offer };
    match.note("choice.offer", "discrete", side, {
      id, from: card.id, options: offer.map((c) => c.id).join(","),
    });
    match.events.push({ type: "choice", side, id, from: card, options: offer });
    return;
  }

  const next = evolution.evolve(card);
  if (!next) return;
  plays[card.id] = 0;
  replaceCard(match, side, card, next);
}

/** Swap a card for its next form in the hand *and* the deck, so every later draw is the evolved one and the old form is gone for good. */
export function replaceCard(
  match: Match,
  side: Side, from: Card, to: Card) {
  for (let i = 0; i < match.hand[side].length; i++) {
    if (match.hand[side][i] === from) match.hand[side][i] = to;
  }
  for (let i = 0; i < match.deck[side].length; i++) {
    if (match.deck[side][i] === from) match.deck[side][i] = to;
  }
  match.note("card.evolve", "discrete", side, { from: from.id, to: to.id });
  match.events.push({ type: "evolve", side, from, to });
}

/** Lock in a branch. */
export function takeChoice(
  match: Match,
  side: Side, choiceId: string, cardId: string): boolean {
  const choice = match.pendingChoice[side];
  if (!choice) return false;
  // Answering by name, and naming the question being answered. An index into
  // the options would be meaningless the moment a second offer is raised
  // before the first is answered -- which the match now allows, because it no
  // longer stops to ask.
  if (choice.id !== choiceId) return false;
  const pick = choice.options.find((c) => c.id === cardId);
  if (!pick) return false;
  match.pendingChoice[side] = undefined;
  match.note("choice.take", "discrete", side, { id: choiceId, to: cardId });
  replaceCard(match, side, choice.from, pick);
  return true;
}

/** How far a card is toward its next form. undefined for terminal cards. */
export function evolutionProgress(
  match: Match,
  side: Side, card: Card): { done: number; needed: number } | undefined {
  const needed = evolution.playsNeeded(card);
  if (!needed) return undefined;
  return { done: match.plays[side][card.id] ?? 0, needed };
}

/** The body a card will deploy as, given what this side has chosen. */
export function formOf(match: Match, side: Side, card: Card): Card {
  if (!card.forms.length) return card;
  const want = match.form[side];
  if (!want || want === card.id) return card;
  if (!card.forms.includes(want)) return card;
  return cards.byId(want) ?? cards.build(want, card) ?? card;
}

/** Choose a body for the next deployment, or clear the choice. */
export function chooseForm(
  match: Match, side: Side, card: Card, form: string | undefined) {
  if (!form) { match.form[side] = undefined; return; }
  if (card.forms.includes(form)) match.form[side] = form;
  else match.note("form.refuse", "local", side, { form, card: card.id });
}

/** Step to the next body, wrapping back round to the base. */
export function cycleForm(match: Match, side: Side, card: Card) {
  if (!card.forms.length) return;
  const at = card.forms.indexOf(match.form[side] ?? card.id);
  const next = card.forms[(at + 1) % card.forms.length];
  match.form[side] = next === card.id ? undefined : next;
  // Local: the screen stages this, and a network deploy carries the body in
  // the intent instead. Nothing needs to be told a card was cycled.
  match.note("form.cycle", "local", side, { to: match.form[side] ?? card.id });
}
