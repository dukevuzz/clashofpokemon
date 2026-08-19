package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** Damage, checked against the game that is already running. */
class DamageTest {

  /** Armour, case by case. */
  @TestFactory
  List<DynamicTest> mitigationMatchesTheTypeScript() {
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonNode row : Fixtures.of("mitigation")) {
      double amount = row.get("amount").asDouble();
      double defence = row.get("defence").asDouble();
      double expected = row.get("out").asDouble();
      tests.add(DynamicTest.dynamicTest(
          "%.0f damage through %.0f armour".formatted(amount, defence),
          () -> assertThat(Damage.mitigate(amount, defence)).isEqualTo(expected)));
    }
    return tests;
  }

  @Test
  void armourNeverTurnsDamageIntoHealing() {
    // The formula is a division, so it cannot -- but it is the property that
    // matters, and a later "improvement" to the curve could break it.
    for (double defence = 0; defence <= 100; defence += 5) {
      assertThat(Damage.mitigate(50, defence)).isPositive().isLessThanOrEqualTo(50);
    }
  }

  @Test
  void noArmourMeansNoReduction() {
    assertThat(Damage.mitigate(42, 0)).isEqualTo(42);
  }

  @Test
  void moreArmourAlwaysHurtsLess() {
    // Monotonic, with no step where stacking armour stops helping -- which is
    // the shape of the curve the balance numbers were tuned against.
    double previous = Double.MAX_VALUE;
    for (double defence = 0; defence <= 60; defence++) {
      double dealt = Damage.mitigate(100, defence);
      assertThat(dealt).isLessThan(previous);
      previous = dealt;
    }
  }
}
