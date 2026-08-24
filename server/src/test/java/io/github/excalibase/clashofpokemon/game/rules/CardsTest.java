package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** The roster, and the fact that it is not transcribed. */
class CardsTest {

  @Test
  void everyCardMatchesTheRunningGame() {
    List<String> wrong = new ArrayList<>();
    int checked = 0;

    for (JsonNode expected : Fixtures.of("cards")) {
      String id = expected.get("id").asString();
      Card actual = Cards.byId(id);
      if (actual == null) {
        wrong.add(id + ": missing entirely");
        continue;
      }
      checked++;
      compare(wrong, id, "hp", expected.get("hp").asInt(), actual.hp());
      compare(wrong, id, "damage", expected.get("damage").asInt(), actual.damage());
      compare(wrong, id, "range", expected.get("range").asInt(), actual.range());
      compare(wrong, id, "def", expected.get("def").asInt(), actual.def());
      compare(wrong, id, "speDef", expected.get("speDef").asInt(), actual.speDef());
      compare(wrong, id, "elixir", expected.get("elixir").asInt(), actual.elixir());
      compare(wrong, id, "count", expected.get("count").asInt(), actual.count());
      if (expected.get("flying").asBoolean() != actual.flying()) {
        wrong.add(id + ": flying");
      }
      if (!expected.get("skill").asString().equals(actual.skill())) {
        wrong.add(id + ": skill");
      }
    }

    assertThat(checked).isEqualTo(151);
    // All of them at once: one wrong card and a wholly wrong derivation look
    // identical when you only ever see the first failure.
    assertThat(wrong).isEmpty();
  }

  private static void compare(List<String> wrong, String id, String field, int a, int b) {
    if (a != b) wrong.add("%s.%s: expected %d, got %d".formatted(id, field, a, b));
  }

  @Test
  void knowsNothingAboutACardThatDoesNotExist() {
    assertThat(Cards.byId("not-a-pokemon")).isNull();
  }

  @Test
  void carriesTheThingsCombatNeeds() {
    Card charmander = Cards.byId("charmander");
    assertThat(charmander).isNotNull();
    assertThat(charmander.hp()).isPositive();
    assertThat(charmander.attackRate()).isPositive();
    assertThat(charmander.targets()).isNotEmpty();
  }

  @Test
  void agreesWithTheClientAboutWhichRosterThisIs() {
    // The version travels in the ticket. A server on a different roster from
    // the client is a server drawing a different game, and it must be
    // detectable at the door rather than in a fight.
    assertThat(Cards.version()).isNotBlank();
  }
}
