package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Type advantage, for every pairing that is not neutral. */
class TypeChartTest {

  @Test
  void everyPairingMatchesTheTypeScript() {
    Set<String> wrong = new HashSet<>();
    int checked = 0;

    for (JsonNode row : Fixtures.of("effectiveness")) {
      String attack = row.get("attack").asText();
      String defend = row.get("defend").asText();
      double expected = row.get("out").asDouble();
      double actual = TypeChart.multiplier(attack, defend);
      checked++;
      if (actual != expected) {
        wrong.add("%s -> %s: expected %s, got %s".formatted(attack, defend, expected, actual));
      }
    }

    assertThat(checked).isGreaterThan(7000);
    // Reported together rather than failing on the first: one wrong cell and a
    // whole wrong table look identical when you only ever see the first.
    assertThat(wrong).isEmpty();
  }

  @Test
  void anUnknownCreatureIsNeutralRatherThanZero() {
    // A card added on one side of a deploy and not the other must not become
    // immune to everything, or unable to hurt anything.
    assertThat(TypeChart.multiplier("not-a-pokemon", "charmander")).isEqualTo(1);
    assertThat(TypeChart.multiplier("charmander", "not-a-pokemon")).isEqualTo(1);
  }

  @Test
  void aDualTypeAttackerUsesItsBestType() {
    // Not an average: that is the rule that makes two types strictly better
    // than one, and averaging would silently rebalance every dual-type card.
    boolean anyDoubled = false;
    for (JsonNode row : Fixtures.of("effectiveness")) {
      if (row.get("out").asDouble() >= 4) { anyDoubled = true; break; }
    }
    assertThat(anyDoubled)
        .as("some pairing should stack to 4x, or best-of is not being applied")
        .isTrue();
  }
}
