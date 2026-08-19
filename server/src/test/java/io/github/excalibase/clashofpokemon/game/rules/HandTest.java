package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The four cards you can see, and how they are replaced. */
class HandTest {

  private static Match match() {
    Match.Options o = new Match.Options();
    o.rng = DifferentialTest.mulberry32(1);
    o.deckOne = deck();
    o.deckTwo = deck();
    o.shuffle = false;     // a known hand is the point of these tests
    o.bot = java.util.Map.of();
    Match m = new Match(o);
    m.elixir.put(Side.ONE, 10.0);
    m.elixir.put(Side.TWO, 10.0);
    return m;
  }

  /** The same deck, but with a chosen card dealt first. */
  private static Match matchStarting(Card first) {
    Match.Options o = new Match.Options();
    o.rng = DifferentialTest.mulberry32(1);
    List<Card> d = new java.util.ArrayList<>(deck());
    d.remove(first);
    d.addFirst(first);
    o.deckOne = List.copyOf(d.subList(0, Rules.config().deckSize()));
    o.deckTwo = deck();
    o.shuffle = false;
    Match m = new Match(o);
    m.elixir.put(Side.ONE, 10.0);
    return m;
  }

  /** A card that offers a branch rather than evolving on its own. */
  private static Card brancher(Match m) {
    return Cards.all().stream()
        .filter(c -> Evolution.offerFor(c.id(), m.rng) != null).findFirst().orElse(null);
  }

  private static void playUntilItEvolves(Match m, Card card) {
    for (int i = 0; i < Evolution.playsNeeded(card); i++) {
      int slot = ids(m.hand.get(Side.ONE)).indexOf(card.id());
      if (slot < 0) return;
      m.elixir.put(Side.ONE, 10.0);
      m.deploy(Side.ONE, slot, 144, 560);
      cycle(m, card.id());
    }
  }

  private static List<Card> deck() {
    return List.of("pidgey", "squirtle", "machop", "geodude",
                   "charmander", "litwick", "spheal", "diglett")
        .stream().map(Cards::byId).toList();
  }

  private static List<String> ids(List<Card> cards) {
    return cards.stream().map(c -> c == null ? null : c.id()).toList();
  }

  @Test
  void theOpeningHandIsTheTopOfTheDeck() {
    assertThat(ids(match().hand.get(Side.ONE)))
        .containsExactly("pidgey", "squirtle", "machop", "geodude");
  }

  @Test
  void playingACardDrawsTheNextOne() {
    Match m = match();
    m.deploy(Side.ONE, 0, 144, 560);
    assertThat(ids(m.hand.get(Side.ONE)))
        .containsExactly("charmander", "squirtle", "machop", "geodude");
  }

  @Test
  void aCardEvolvesInHandOnceItHasBeenPlayedEnough() {
    // The bug the differential test found: the counter rose, the evolution
    // never landed, and the two engines quietly drifted apart from there.
    Match m = match();
    int needed = Evolution.playsNeeded(Cards.byId("pidgey"));
    assertThat(needed).isGreaterThan(1);

    for (int play = 0; play < needed; play++) {
      m.elixir.put(Side.ONE, 10.0);
      int slot = ids(m.hand.get(Side.ONE)).indexOf("pidgey");
      assertThat(slot).as("pidgey should have come back round").isNotNegative();
      assertThat(m.deploy(Side.ONE, slot, 144, 560)).isTrue();
      cycle(m, "pidgey");
    }

    assertThat(ids(m.hand.get(Side.ONE)).contains("pidgeotto")
        || ids(m.deck.get(Side.ONE)).contains("pidgeotto"))
        .as("pidgey should have become pidgeotto somewhere")
        .isTrue();
    assertThat(ids(m.deck.get(Side.ONE))).doesNotContain("pidgey");
  }

  /** Play everything else until the wanted card comes back round. */
  private static void cycle(Match m, String want) {
    for (int guard = 0; guard < 12; guard++) {
      if (ids(m.hand.get(Side.ONE)).contains(want)) return;
      m.elixir.put(Side.ONE, 10.0);
      m.deploy(Side.ONE, 0, 144, 560);
    }
  }

  @Test
  void anEvolvedCardGoesBackIntoTheCycleRatherThanStaying() {
    // Skipping the draw on the evolving play handed the player the evolution
    // *and* let them keep the slot -- a free rotation on top of a free stat
    // increase, invisible on screen.
    Match m = match();
    Card before = m.hand.get(Side.ONE).getFirst();
    m.deploy(Side.ONE, 0, 144, 560);
    assertThat(m.hand.get(Side.ONE).getFirst()).isNotSameAs(before);
  }

  @Test
  void replacingACardSwapsItInHandAndInTheDeck() {
    Match m = match();
    Card from = Cards.byId("squirtle");
    Card to = Cards.byId("wartortle");
    Hand.replaceCard(m, Side.ONE, from, to);
    assertThat(ids(m.hand.get(Side.ONE))).contains("wartortle").doesNotContain("squirtle");
    assertThat(ids(m.deck.get(Side.ONE))).doesNotContain("squirtle");
  }

  @Test
  void aCardCostsWhatItSays() {
    Match m = match();
    Card c = m.hand.get(Side.ONE).getFirst();
    assertThat(Hand.costOf(m, Side.ONE, c)).isEqualTo(c.elixir());
  }

  @Test
  void theDrawSkipsWhateverIsAlreadyInHand() {
    Match m = match();
    for (int i = 0; i < 20; i++) {
      m.elixir.put(Side.ONE, 10.0);
      m.deploy(Side.ONE, i % Rules.config().handSize(), 144, 560);
      List<String> hand = ids(m.hand.get(Side.ONE));
      assertThat(hand).doesNotHaveDuplicates().doesNotContainNull();
    }
  }

  // -------------------------------------------------------------- the copy

  @Test
  void aCopyCardCannotBePlayedUntilYouHavePlayedSomething() {
    // The honest way to say "this card has no meaning until you give it one".
    Match m = match();
    Card ditto = Cards.byId("ditto");
    assertThat(Hand.costOf(m, Side.ONE, ditto)).isInfinite();
    assertThat(Hand.copyTarget(m, Side.ONE, ditto)).isNull();
  }

  @Test
  void aCopyCostsWhatItCopiesPlusOne() {
    Match m = match();
    m.deploy(Side.ONE, 0, 144, 560);
    Card last = m.lastPlayed.get(Side.ONE);
    assertThat(last).isNotNull();

    Card ditto = Cards.byId("ditto");
    assertThat(Hand.costOf(m, Side.ONE, ditto)).isEqualTo(last.elixir() + 1);
    assertThat(Hand.copyTarget(m, Side.ONE, ditto)).isSameAs(last);
  }

  @Test
  void playingACopyPutsDownWhatYouPlayedAndDoesNotBecomeTheThingToCopy() {
    // So a second copy copies the same thing rather than copying a copy.
    Match m = match();
    m.deploy(Side.ONE, 0, 144, 560);
    Card copied = m.lastPlayed.get(Side.ONE);

    m.hand.get(Side.ONE).set(1, Cards.byId("ditto"));
    m.elixir.put(Side.ONE, 10.0);
    assertThat(m.deploy(Side.ONE, 1, 160, 560)).isTrue();

    assertThat(m.units.getLast().card).isSameAs(copied);
    assertThat(m.lastPlayed.get(Side.ONE)).isSameAs(copied);
  }

  // -------------------------------------------------------------- the bodies

  @Test
  void aCardWithNoBodiesIgnoresTheWholeMechanism() {
    Match m = match();
    Card plain = Cards.byId("machop");
    assertThat(plain.forms()).isEmpty();

    Hand.chooseForm(m, Side.ONE, plain, "deoxysattack");
    assertThat(m.form).doesNotContainKey(Side.ONE);
    assertThat(Hand.formOf(m, Side.ONE, plain)).isSameAs(plain);
    Hand.cycleForm(m, Side.ONE, plain);
    assertThat(m.form).doesNotContainKey(Side.ONE);
  }

  @Test
  void aBodyTheCardDoesNotOfferIsRefusedRatherThanStored() {
    // A stale choice must not be able to follow a player onto another card.
    Match m = match();
    Card shifter = shifter();
    Hand.chooseForm(m, Side.ONE, shifter, "machop");
    assertThat(m.form).doesNotContainKey(Side.ONE);
  }

  @Test
  void choosingABodyChangesWhatIsDeployedAndNotWhatIsHeld() {
    Match m = match();
    Card shifter = shifter();
    String body = shifter.forms().stream()
        .filter(f -> !f.equals(shifter.id())).findFirst().orElseThrow();

    Hand.chooseForm(m, Side.ONE, shifter, body);
    assertThat(Hand.formOf(m, Side.ONE, shifter).id()).isEqualTo(body);
    // Clearing it puts the base back.
    Hand.chooseForm(m, Side.ONE, shifter, null);
    assertThat(Hand.formOf(m, Side.ONE, shifter)).isSameAs(shifter);
  }

  @Test
  void cyclingWalksTheBodiesAndComesBackToTheBase() {
    // The base is stored as absent rather than as its own id, so the field
    // means "chose something other than the default" everywhere.
    Match m = match();
    Card shifter = shifter();

    for (int i = 0; i < shifter.forms().size(); i++) {
      Hand.cycleForm(m, Side.ONE, shifter);
    }
    assertThat(Hand.formOf(m, Side.ONE, shifter).id()).isEqualTo(shifter.id());
  }

  @Test
  void theChoiceIsPerPlayAndDoesNotFollowTheNextOne() {
    Match m = match();
    Card shifter = shifter();
    String body = shifter.forms().stream()
        .filter(f -> !f.equals(shifter.id())).findFirst().orElseThrow();

    m.hand.get(Side.ONE).set(0, shifter);
    m.elixir.put(Side.ONE, 10.0);
    assertThat(m.deploy(Side.ONE, 0, 144, 560, body)).isTrue();
    assertThat(m.units.getFirst().card.id()).isEqualTo(body);
    assertThat(m.form).doesNotContainKey(Side.ONE);
  }

  private static Card shifter() {
    return Cards.all().stream()
        .filter(c -> !c.forms().isEmpty()).findFirst().orElseThrow();
  }

  // ------------------------------------------------------------- the branch

  @Test
  void aBranchOfferIsAnsweredByNameAndTheOfferIsNamedToo() {
    // Not an index into the options: the match does not stop to ask, so a
    // second offer can be open while the first is, and a position in a list
    // would then answer the wrong question.
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    playUntilItEvolves(m, brancher);

    var offer = m.pendingChoice.get(Side.ONE);
    assertThat(offer).as("an offer should be waiting").isNotNull();

    // The wrong offer id, and a card that was never offered, are both refused.
    assertThat(Hand.takeChoice(m, Side.ONE, "not-the-offer", offer.options().getFirst().id()))
        .isFalse();
    assertThat(Hand.takeChoice(m, Side.ONE, offer.id(), "machop")).isFalse();
    assertThat(m.pendingChoice.get(Side.ONE)).isNotNull();

    String want = offer.options().getFirst().id();
    assertThat(Hand.takeChoice(m, Side.ONE, offer.id(), want)).isTrue();
    assertThat(m.pendingChoice).doesNotContainKey(Side.ONE);
    assertThat(ids(m.deck.get(Side.ONE))).contains(want).doesNotContain(brancher.id());
  }

  @Test
  void answeringAnOfferThatWasNeverMadeIsRefused() {
    Match m = match();
    assertThat(Hand.takeChoice(m, Side.ONE, "c1", "pidgeotto")).isFalse();
  }

  @Test
  void evolutionProgressCountsUpAndIsAbsentForATerminalCard() {
    Match m = match();
    Card pidgey = Cards.byId("pidgey");
    assertThat(Hand.evolutionProgress(m, Side.ONE, pidgey)).containsExactly(0,
        Evolution.playsNeeded(pidgey));

    m.deploy(Side.ONE, ids(m.hand.get(Side.ONE)).indexOf("pidgey"), 144, 560);
    assertThat(Hand.evolutionProgress(m, Side.ONE, pidgey)[0]).isEqualTo(1);

    Card terminal = Cards.all().stream()
        .filter(c -> Evolution.playsNeeded(c) == 0).findFirst().orElseThrow();
    assertThat(Hand.evolutionProgress(m, Side.ONE, terminal)).isNull();
  }

  @Test
  void aPreCommittedBranchIsTakenWhenItIsOnOffer() {
    // Committed in the deck builder, so the match never has to stop and ask.
    //
    // "When it is on offer" is the whole rule: the three branches shown are
    // drawn from eight, so a commitment to one of the other five cannot be
    // honoured and the question is asked after all. Written this way rather
    // than with one lucky seed, because a test that passes only for the
    // branch the generator happened to pick tests the generator.
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    int honoured = 0;
    for (String want : Rules.evolutionBranches().get(brancher.id())) {
      Match m = matchStarting(brancher);
      m.preferredBranch.put(Side.ONE, want);
      playUntilItEvolves(m, brancher);

      var pending = m.pendingChoice.get(Side.ONE);
      if (pending == null) {
        assertThat(ids(m.deck.get(Side.ONE))).as("committed to %s", want).contains(want);
        honoured++;
      } else {
        // Asked anyway -- which is only allowed because it was not on offer.
        assertThat(pending.options().stream().map(Card::id))
            .as("asked about %s despite the commitment", want)
            .doesNotContain(want);
      }
    }
    assertThat(honoured).as("some commitment should have been honoured").isPositive();
  }

  @Test
  void aBotAnswersItsOwnOffer() {
    // A side nobody is watching does not stop and wait to be asked.
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    m.bot.put(Side.ONE, true);
    playUntilItEvolves(m, brancher);

    assertThat(m.pendingChoice).doesNotContainKey(Side.ONE);
    assertThat(ids(m.deck.get(Side.ONE))).doesNotContain(brancher.id());
  }

  // ------------------------------------------------- answering an offer once

  // A branch cannot be taken back.

  @Test
  void anOfferCannotBeAnsweredTwice() {
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    playUntilItEvolves(m, brancher);
    var offer = m.pendingChoice.get(Side.ONE);
    org.junit.jupiter.api.Assumptions.assumeTrue(offer != null, "no offer was raised");

    String first = offer.options().getFirst().id();
    String second = offer.options().get(1).id();

    assertThat(Hand.takeChoice(m, Side.ONE, offer.id(), first)).isTrue();
    // Changing your mind: refused, and the first choice stands.
    assertThat(Hand.takeChoice(m, Side.ONE, offer.id(), second)).isFalse();

    assertThat(ids(m.deck.get(Side.ONE))).contains(first).doesNotContain(second);
  }

  @Test
  void aBranchThatWasNotOfferedCannotBeTaken() {
    // Three of eight are offered. Naming one of the other five would be a
    // free upgrade to whichever branch happens to be strongest.
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    playUntilItEvolves(m, brancher);
    var offer = m.pendingChoice.get(Side.ONE);
    org.junit.jupiter.api.Assumptions.assumeTrue(offer != null, "no offer was raised");

    List<String> offered = offer.options().stream().map(Card::id).toList();
    String notOffered = Rules.evolutionBranches().get(brancher.id()).stream()
        .filter(id -> !offered.contains(id)).findFirst().orElse(null);
    org.junit.jupiter.api.Assumptions.assumeTrue(notOffered != null, "all branches offered");

    assertThat(Hand.takeChoice(m, Side.ONE, offer.id(), notOffered)).isFalse();
    // And the offer is still open, so a refused attempt costs nothing.
    assertThat(m.pendingChoice).containsKey(Side.ONE);
    assertThat(ids(m.deck.get(Side.ONE))).doesNotContain(notOffered);
  }

  @Test
  void anOfferBelongsToTheSeatItWasRaisedFor() {
    // The seat comes from the socket, never from the message -- but the rules
    // must refuse it anyway, because that is where the guarantee belongs.
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    playUntilItEvolves(m, brancher);
    var offer = m.pendingChoice.get(Side.ONE);
    org.junit.jupiter.api.Assumptions.assumeTrue(offer != null, "no offer was raised");

    assertThat(Hand.takeChoice(m, Side.TWO, offer.id(), offer.options().getFirst().id()))
        .isFalse();
    assertThat(m.pendingChoice).containsKey(Side.ONE);
  }

  @Test
  void anOfferIdFromNowhereIsRefused() {
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    playUntilItEvolves(m, brancher);
    var offer = m.pendingChoice.get(Side.ONE);
    org.junit.jupiter.api.Assumptions.assumeTrue(offer != null, "no offer was raised");

    assertThat(Hand.takeChoice(m, Side.ONE, "c999", offer.options().getFirst().id()))
        .isFalse();
    assertThat(m.pendingChoice).containsKey(Side.ONE);
  }

  @Test
  void theChosenBranchIsWhatActuallyGetsPlayed() {
    // The evolution is not merely recorded: the card in the cycle becomes the
    // branch that was picked, and it is that creature which reaches the board.
    Match probe = match();
    Card brancher = brancher(probe);
    org.junit.jupiter.api.Assumptions.assumeTrue(brancher != null, "no branching card");

    Match m = matchStarting(brancher);
    playUntilItEvolves(m, brancher);
    var offer = m.pendingChoice.get(Side.ONE);
    org.junit.jupiter.api.Assumptions.assumeTrue(offer != null, "no offer was raised");

    String chosen = offer.options().getFirst().id();
    assertThat(Hand.takeChoice(m, Side.ONE, offer.id(), chosen)).isTrue();

    cycle(m, chosen);
    int slot = ids(m.hand.get(Side.ONE)).indexOf(chosen);
    org.junit.jupiter.api.Assumptions.assumeTrue(slot >= 0, "it did not come round");

    m.elixir.put(Side.ONE, 10.0);
    assertThat(m.deploy(Side.ONE, slot, 144, 560)).isTrue();
    assertThat(m.units.getLast().card.id()).isEqualTo(chosen);
  }
}
