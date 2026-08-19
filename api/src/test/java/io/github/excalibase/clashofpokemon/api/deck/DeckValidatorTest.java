package io.github.excalibase.clashofpokemon.api.deck;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** What makes a deck legal. */
class DeckValidatorTest {

  static DeckValidator validator;

  @BeforeAll
  static void setUp() {
    validator = new DeckValidator(new ContentService());
  }

  private static final List<String> GOOD =
      List.of("charmander", "snorlax", "voltorb", "machop", "geodude", "eevee");

  @Test
  void acceptsALegalDeck() {
    assertThat(validator.check(GOOD, "togekiss", null)).isEmpty();
  }

  @Test
  void acceptsAPreCommittedBranch() {
    assertThat(validator.check(GOOD, "togekiss", "vaporeon")).isEmpty();
  }

  @Test
  void rejectsTooFewCards() {
    var problems = validator.check(GOOD.subList(0, 5), "togekiss", null);
    assertThat(problems).singleElement()
        .satisfies(p -> {
          assertThat(p.field()).isEqualTo("cards");
          assertThat(p.message()).contains("6").contains("5");
        });
  }

  @Test
  void rejectsTooManyCards() {
    var seven = new java.util.ArrayList<>(GOOD);
    seven.add("pikachu");
    assertThat(validator.check(seven, "togekiss", null)).hasSize(1);
  }

  @Test
  void namesTheCardItDoesNotKnow() {
    var problems = validator.check(
        List.of("charmander", "not-a-pokemon", "voltorb", "machop", "geodude", "eevee"),
        "togekiss", null);
    assertThat(problems).singleElement()
        .satisfies(p -> assertThat(p.message()).contains("not-a-pokemon"));
  }

  @Test
  void rejectsACardThatCannotBeChosen() {
    // Charmeleon is a real card that fights, but it is reached by playing
    // Charmander -- never chosen. A deck naming it came from a broken client.
    var problems = validator.check(
        List.of("charmeleon", "snorlax", "voltorb", "machop", "geodude", "eevee"),
        "togekiss", null);
    assertThat(problems).singleElement()
        .satisfies(p -> assertThat(p.message()).contains("charmeleon"));
  }

  @Test
  void namesTheDuplicate() {
    var problems = validator.check(
        List.of("charmander", "charmander", "voltorb", "machop", "geodude", "eevee"),
        "togekiss", null);
    assertThat(problems).singleElement()
        .satisfies(p -> assertThat(p.message()).contains("charmander"));
  }

  @Test
  void rejectsAnUnknownTroop() {
    var problems = validator.check(GOOD, "mewtwo", null);
    assertThat(problems).singleElement()
        .satisfies(p -> {
          assertThat(p.field()).isEqualTo("troop");
          assertThat(p.message()).contains("mewtwo");
        });
  }

  @Test
  void rejectsABranchEeveeDoesNotOffer() {
    var problems = validator.check(GOOD, "togekiss", "charizard");
    assertThat(problems).singleElement()
        .satisfies(p -> assertThat(p.field()).isEqualTo("branch"));
  }

  @Test
  void reportsEveryProblemAtOnce() {
    // One round trip, one list of everything wrong. Fixing a deck one
    // rejection at a time is six requests and a bad afternoon.
    var problems = validator.check(
        List.of("nope", "nope", "voltorb"), "not-a-troop", "not-a-branch");
    assertThat(problems).hasSizeGreaterThan(2);
    assertThat(problems).extracting(DeckProblem::field)
        .contains("cards", "troop", "branch");
  }
}
