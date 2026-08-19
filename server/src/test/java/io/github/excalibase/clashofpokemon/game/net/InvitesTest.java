package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.Set;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

/** A code you read out loud. */
class InvitesTest {

  private static final class Movable extends Clock {
    private Instant now = Instant.parse("2026-01-01T00:00:00Z");

    void pass(long millis) {
      now = now.plusMillis(millis);
    }

    @Override public Instant instant() {
      return now;
    }

    @Override public ZoneOffset getZone() {
      return ZoneOffset.UTC;
    }

    @Override public Clock withZone(java.time.ZoneId zone) {
      return this;
    }
  }

  private static Invites<String> invites() {
    return new Invites<>();
  }

  @Test
  void aRoomIsOpenedAndClaimedOnce() {
    Invites<String> rooms = invites();
    String code = rooms.open("ana");

    assertThat(rooms.size()).isEqualTo(1);
    assertThat(rooms.claim(code)).isEqualTo("ana");
    // Claiming removes it: a code is for one guest, not for anybody who heard it.
    assertThat(rooms.claim(code)).isNull();
    assertThat(rooms.size()).isZero();
  }

  @Test
  void aCodeSurvivesBeingSpokenAndRetyped() {
    Invites<String> rooms = invites();
    String code = rooms.open("ana");
    assertThat(rooms.claim("  " + code.toLowerCase(java.util.Locale.ROOT) + " "))
        .isEqualTo("ana");
  }

  @Test
  void theAlphabetAvoidsTheCharactersPeopleConfuse() {
    // "Was that an oh or a zero" is the whole failure mode.
    assertThat(Protocol.INVITE_ALPHABET).doesNotContain("O").doesNotContain("0")
        .doesNotContain("I").doesNotContain("1");

    Invites<String> rooms = invites();
    for (int i = 0; i < 200; i++) {
      String code = rooms.open("someone" + i);
      assertThat(code).hasSize(Protocol.INVITE_LENGTH);
      assertThat(code.chars())
          .allMatch(c -> Protocol.INVITE_ALPHABET.indexOf(c) >= 0);
    }
  }

  @Test
  void aCodeThatIsNotARoomIsSimplyNotARoom() {
    Invites<String> rooms = invites();
    assertThat(rooms.claim("ZZZZZ")).isNull();
    assertThat(rooms.claim(null)).isNull();
  }

  @Test
  void aRoomExpiresRatherThanWaitingForever() {
    Movable clock = new Movable();
    Invites<String> rooms = new Invites<>(clock, RandomGenerator.getDefault());
    String code = rooms.open("ana");

    clock.pass(Invites.LIFETIME_MS + 1);
    assertThat(rooms.size()).isZero();
    assertThat(rooms.claim(code)).isNull();
  }

  @Test
  void anOwnerWhoLeavesGivesUpTheirRoom() {
    Invites<String> rooms = invites();
    String hers = rooms.open("ana");
    String his = rooms.open("bo");

    rooms.cancel("ana"::equals);
    assertThat(rooms.claim(hers)).isNull();
    assertThat(rooms.claim(his)).isEqualTo("bo");
  }

  @Test
  void aCollisionIsRetriedRatherThanAssumedAway() {
    // Two pairs of friends dropped into each other's games is the consequence,
    // so a generator that always says the same thing must not seat them together.
    RandomGenerator stubborn = new RandomGenerator() {
      private int calls;

      @Override public double nextDouble() {
        // The same code the first five draws, then a different one.
        return calls++ < Protocol.INVITE_LENGTH ? 0 : 0.5;
      }

      @Override public long nextLong() {
        return 0;
      }
    };

    Invites<String> rooms = new Invites<>(Clock.systemUTC(), stubborn);
    String first = rooms.open("ana");
    String second = rooms.open("bo");

    assertThat(second).isNotEqualTo(first);
    assertThat(rooms.claim(first)).isEqualTo("ana");
    assertThat(rooms.claim(second)).isEqualTo("bo");
  }

  @Test
  void aGeneratorThatCanOnlySayOneThingIsRefusedRatherThanLooping() {
    RandomGenerator stuck = new RandomGenerator() {
      @Override public double nextDouble() {
        return 0;
      }

      @Override public long nextLong() {
        return 0;
      }
    };

    Invites<String> rooms = new Invites<>(Clock.systemUTC(), stuck);
    rooms.open("ana");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> rooms.open("bo"))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void codesAreSpreadAcrossTheAlphabetRatherThanClustered() {
    Invites<String> rooms = invites();
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < 500; i++) seen.add(rooms.open("p" + i));
    // 32^5 is thirty-three million; 500 draws should collide with nobody.
    assertThat(seen).hasSize(500);
  }
}
