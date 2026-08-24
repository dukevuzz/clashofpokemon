package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** Growing, checked against the game that already grows things. */
class EvolutionTest {

  @Test
  void everyCardNeedsTheSamePlaysAndGrowsTheSameWay() {
    List<String> wrong = new ArrayList<>();
    int checked = 0;

    for (JsonNode row : Fixtures.of("evolutions")) {
      String id = row.get("id").asString();
      Card card = Cards.byId(id);
      if (card == null) continue;
      checked++;

      int needs = Evolution.playsNeeded(card);
      if (needs != row.get("needs").asInt()) {
        wrong.add("%s: needs %d, expected %d".formatted(id, needs, row.get("needs").asInt()));
      }

      List<String> chain = Evolution.chainOf(id);
      List<String> expected = row.get("chain").valueStream().map(JsonNode::asString).toList();
      if (!chain.equals(expected)) {
        wrong.add("%s: chain %s, expected %s".formatted(id, chain, expected));
      }
    }

    assertThat(checked).isEqualTo(151);
    assertThat(wrong).isEmpty();
  }

  @Test
  void aTerminalCardNeedsNothingAndGoesNowhere() {
    // Zero rather than null, because every caller asks "is it time yet" and a
    // card that never evolves is never time.
    String terminal = null;
    for (Card c : Cards.all()) {
      if (Evolution.nextOf(c.id()) == null && Evolution.branchesFor(c.id()) == null) {
        terminal = c.id();
        break;
      }
    }
    assertThat(terminal).as("the roster should contain a terminal card").isNotNull();
    assertThat(Evolution.playsNeeded(Cards.byId(terminal))).isZero();
    assertThat(Evolution.chainOf(terminal)).containsExactly(terminal);
  }

  @Test
  void eeveeBranchesRatherThanEvolving() {
    assertThat(Evolution.nextOf("eevee")).isNull();
    assertThat(Evolution.branchesFor("eevee")).hasSize(8);
    assertThat(Evolution.playsNeeded(Cards.byId("eevee"))).isPositive();
  }

  @Test
  void offersThreeOfTheEight() {
    // Three because picking from everything is a menu and picking from three
    // is a decision you can make in a real-time match.
    var rng = RandomGenerator.getDefault();
    for (int i = 0; i < 20; i++) {
      List<String> offer = Evolution.offerFor("eevee", rng);
      assertThat(offer).hasSize(Evolution.BRANCH_OFFER);
      assertThat(offer).doesNotHaveDuplicates();
      assertThat(Evolution.branchesFor("eevee")).containsAll(offer);
    }
  }

  @Test
  void doesNotOfferAnythingForACardThatDoesNotBranch() {
    assertThat(Evolution.offerFor("charmander", RandomGenerator.getDefault())).isNull();
  }

  @Test
  void aChainEndsRatherThanLooping() {
    // A cycle in the data would hang the loop rather than fail it, which is
    // the worst way for bad data to arrive.
    for (Card c : Cards.all()) {
      assertThat(Evolution.chainOf(c.id())).hasSizeLessThan(20);
    }
  }
}
