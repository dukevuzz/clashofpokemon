package io.github.excalibase.clashofpokemon.game.rules;

import java.util.ArrayList;
import java.util.List;

/** The hand, the deck, and what a card becomes. */
public final class Hand {

  private Hand() {}

  /** Cycle the deck, skipping anything already in hand. */
  public static void drawFromDeck(Match match, Side side, int slot) {
    List<Card> deck = match.deck.get(side);
    List<Card> hand = match.hand.get(side);
    for (int n = 0; n < deck.size(); n++) {
      int idx = (match.drawIndex.get(side) + n) % deck.size();
      Card card = deck.get(idx);
      if (!hand.contains(card)) {
        hand.set(slot, card);
        match.drawIndex.put(side, (idx + 1) % deck.size());
        return;
      }
    }
  }

  /** What this card costs right now. */
  public static double costOf(Match match, Side side, Card card) {
    if (!isCopy(card)) return card.elixir();
    Card target = match.lastPlayed.get(side);
    return target != null ? target.elixir() + 1 : Double.POSITIVE_INFINITY;
  }

  /** A copy card has no skill of its own; it borrows whatever it copied. */
  private static boolean isCopy(Card card) {
    return "ditto".equals(card.id());
  }

  public static Card copyTarget(Match match, Side side, Card card) {
    return isCopy(card) ? match.lastPlayed.get(side) : null;
  }

  /** Playing a card advances it. */
  public static void countPlay(Match match, Side side, Card card) {
    int needed = Evolution.playsNeeded(card);
    if (needed == 0) return;

    var plays = match.plays.get(side);
    plays.merge(card.id(), 1, Integer::sum);
    if (plays.get(card.id()) < needed) return;

    List<String> offer = Evolution.offerFor(card.id(), match.rng);
    if (offer != null && !offer.isEmpty()) {
      plays.put(card.id(), 0);
      int slot = match.hand.get(side).indexOf(card);

      // Committed ahead of time in the deck builder: no interruption at all --
      // but only if the chosen branch is among the three on offer.
      String want = match.preferredBranch.get(side);
      if (want != null && offer.contains(want)) {
        replaceCard(match, side, card, Cards.byId(want));
        return;
      }
      // A side nobody is watching answers itself.
      if (Boolean.TRUE.equals(match.bot.get(side))) {
        String pick = offer.get((int) Math.floor(match.rng.nextDouble() * offer.size()));
        replaceCard(match, side, card, Cards.byId(pick));
        return;
      }
      List<Card> options = new ArrayList<>();
      for (String id : offer) options.add(Cards.byId(id));
      String id = match.nextChoiceId();
      match.pendingChoice.put(side, new Match.PendingChoice(id, slot, card, options));
      match.events.add(new MatchEvent.Choice(side, id, card, List.copyOf(options)));
      return;
    }

    String next = Evolution.nextOf(card.id());
    if (next == null) return;
    plays.put(card.id(), 0);
    replaceCard(match, side, card, Cards.byId(next));
  }

  /** Swap a card for its next form, in the hand and the deck. */
  public static void replaceCard(Match match, Side side, Card from, Card to) {
    if (to == null) return;
    List<Card> hand = match.hand.get(side);
    for (int i = 0; i < hand.size(); i++) {
      if (hand.get(i) == from) hand.set(i, to);
    }
    List<Card> deck = match.deck.get(side);
    for (int i = 0; i < deck.size(); i++) {
      if (deck.get(i) == from) deck.set(i, to);
    }
    match.events.add(new MatchEvent.Evolve(side, from, to));
  }

  /** Answer a branch offer, by name, naming the offer being answered. */
  public static boolean takeChoice(Match match, Side side, String choiceId, String cardId) {
    var choice = match.pendingChoice.get(side);
    if (choice == null) return false;
    if (!choice.id().equals(choiceId)) return false;

    Card pick = null;
    for (Card c : choice.options()) {
      if (c.id().equals(cardId)) { pick = c; break; }
    }
    if (pick == null) return false;

    match.pendingChoice.remove(side);
    replaceCard(match, side, choice.from(), pick);
    return true;
  }

  /** How far a card is toward its next form, or null for a terminal one. */
  public static int[] evolutionProgress(Match match, Side side, Card card) {
    int needed = Evolution.playsNeeded(card);
    if (needed == 0) return null;
    return new int[] {match.plays.get(side).getOrDefault(card.id(), 0), needed};
  }

  /** The body a card deploys as, given what this side has chosen. */
  public static Card formOf(Match match, Side side, Card card) {
    if (card.forms().isEmpty()) return card;
    String want = match.form.get(side);
    if (want == null || want.equals(card.id())) return card;
    if (!card.forms().contains(want)) return card;
    Card built = Cards.byId(want);
    return built != null ? built : card;
  }

  /** Choose a body, or clear the choice. Refuses one the card does not offer. */
  public static void chooseForm(Match match, Side side, Card card, String form) {
    if (form == null) { match.form.remove(side); return; }
    if (card.forms().contains(form)) match.form.put(side, form);
  }

  /** Step to the next body, wrapping back round to the base. */
  public static void cycleForm(Match match, Side side, Card card) {
    if (card.forms().isEmpty()) return;
    String current = match.form.getOrDefault(side, card.id());
    int at = card.forms().indexOf(current);
    String next = card.forms().get((at + 1) % card.forms().size());
    // The base is stored as absent rather than its own id, so the field means
    // "chose something other than the default" everywhere.
    if (next.equals(card.id())) match.form.remove(side);
    else match.form.put(side, next);
  }
}
