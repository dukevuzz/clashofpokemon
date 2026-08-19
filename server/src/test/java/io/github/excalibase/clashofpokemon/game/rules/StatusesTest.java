package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** Afflictions, against the answers the running game gave. */
class StatusesTest {

  @Test
  void everyMoveInflictsWhatTheTypeScriptSays() {
    List<String> wrong = new ArrayList<>();
    for (JsonNode row : Fixtures.of("statuses")) {
      String move = row.get("move").asString();
      var effect = Statuses.MOVE_STATUS.get(move);
      if (effect == null) {
        wrong.add(move + ": missing");
        continue;
      }
      if (!effect.kind().wire().equals(row.get("kind").asString())) {
        wrong.add(move + ": kind");
      }
      if (effect.seconds() != row.get("seconds").asDouble()) wrong.add(move + ": seconds");
      if (effect.chance() != row.get("chance").asDouble()) wrong.add(move + ": chance");
    }
    assertThat(wrong).isEmpty();
    assertThat(Statuses.MOVE_STATUS).hasSize(14);
  }

  @Test
  void applyingFollowsTheSameSequences() {
    // Replays the exact sequences the TypeScript was run through, and compares
    // what is left afterwards.
    for (JsonNode row : Fixtures.of("statusSequences")) {
      List<Status> list = new ArrayList<>();
      for (JsonNode step : row.get("steps")) {
        Statuses.apply(list, StatusKind.of(step.get(0).asString()), step.get(1).asDouble());
      }
      JsonNode expected = row.get("after");
      assertThat(list).hasSize(expected.size());
      for (int i = 0; i < list.size(); i++) {
        assertThat(list.get(i).kind.wire()).isEqualTo(expected.get(i).get("kind").asString());
        assertThat(list.get(i).left).isEqualTo(expected.get(i).get("left").asDouble());
      }
    }
  }

  @Test
  void tickingDownMatchesStepForStep() {
    List<Status> list = new ArrayList<>();
    Statuses.apply(list, StatusKind.FREEZE, 1);
    Statuses.apply(list, StatusKind.BURN, 3);

    for (JsonNode step : Fixtures.of("statusTicks")) {
      Statuses.tick(list, step.get("dt").asDouble());
      JsonNode expected = step.get("left");
      assertThat(list).as("after %s", step.get("dt")).hasSize(expected.size());
      for (int i = 0; i < list.size(); i++) {
        assertThat(list.get(i).left)
            .isCloseTo(expected.get(i).get("left").asDouble(), org.assertj.core.data.Offset.offset(1e-6));
      }
    }
  }

  @Test
  void applyingTwiceExtendsRatherThanStacks() {
    // Two paralysis casts do not make a creature twice as slow.
    List<Status> list = new ArrayList<>();
    Statuses.apply(list, StatusKind.PARALYSIS, 3);
    Statuses.apply(list, StatusKind.PARALYSIS, 3);
    assertThat(list).hasSize(1);
  }

  @Test
  void aShorterApplicationDoesNotCutALongerOneShort() {
    List<Status> list = new ArrayList<>();
    Statuses.apply(list, StatusKind.BURN, 5);
    Statuses.apply(list, StatusKind.BURN, 1);
    assertThat(list.get(0).left).isEqualTo(5);
  }

  @Test
  void beingHitWakesYou() {
    // Otherwise a sleep is an execution rather than a reprieve for whoever
    // cast it.
    List<Status> list = new ArrayList<>();
    Statuses.apply(list, StatusKind.SLEEP, 5);
    assertThat(Statuses.frozen(list)).isTrue();
    Statuses.wake(list);
    assertThat(Statuses.has(list, StatusKind.SLEEP)).isFalse();
  }

  @Test
  void wakingLeavesEverythingElseAlone() {
    List<Status> list = new ArrayList<>();
    Statuses.apply(list, StatusKind.SLEEP, 5);
    Statuses.apply(list, StatusKind.BURN, 5);
    Statuses.wake(list);
    assertThat(Statuses.has(list, StatusKind.BURN)).isTrue();
  }

  @Test
  void anExpiredStatusIsGoneRatherThanZero() {
    List<Status> list = new ArrayList<>();
    Statuses.apply(list, StatusKind.FREEZE, 1);
    assertThat(Statuses.tick(list, 1.5)).isTrue();
    assertThat(list).isEmpty();
    assertThat(Statuses.has(list, StatusKind.FREEZE)).isFalse();
  }

  @Test
  void freezeAndSleepBothStopEverything() {
    List<Status> frozen = new ArrayList<>();
    Statuses.apply(frozen, StatusKind.FREEZE, 1);
    assertThat(Statuses.frozen(frozen)).isTrue();

    List<Status> burning = new ArrayList<>();
    Statuses.apply(burning, StatusKind.BURN, 1);
    assertThat(Statuses.frozen(burning)).isFalse();
  }

  @Test
  void loadsItsNumbersRatherThanDeclaringThem() {
    // If these were typed out here they would drift the next time a curve was
    // tuned, and nothing would say so.
    assertThat(Rules.config().handSize()).isEqualTo(4);
    assertThat(Rules.config().deckSize()).isEqualTo(6);
    assertThat(Rules.version()).isNotBlank();
  }
}
