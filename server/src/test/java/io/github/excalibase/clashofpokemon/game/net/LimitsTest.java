package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** What one socket may say, and how many sockets one machine may open. */
class LimitsTest {

  /** A clock a test can move, so a window can pass without a test sleeping. */
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

  @Test
  void anHonestClientIsNeverRefused() {
    // Auth, loaded, a deploy every few seconds and a ping: under five a second.
    Movable clock = new Movable();
    var allow = new Limits(clock, Limits.DEFAULT_MAX_UNAUTHENTICATED).allowance();

    for (int second = 0; second < 180; second++) {
      for (int i = 0; i < 5; i++) {
        assertThat(allow.accept(60)).as("second %d", second).isTrue();
      }
      clock.pass(1000);
    }
  }

  @Test
  void oneEnormousFrameIsRefusedOnSizeAlone() {
    var allow = new Limits().allowance();
    assertThat(allow.accept(Limits.MAX_FRAME_BYTES)).isTrue();
    assertThat(allow.accept(Limits.MAX_FRAME_BYTES + 1)).isFalse();
    assertThat(allow.reason()).isEqualTo("message too large");
  }

  @Test
  void aFloodOfSmallFramesIsRefusedOnRate() {
    var allow = new Limits().allowance();
    for (int i = 0; i < Limits.MAX_PER_WINDOW; i++) {
      assertThat(allow.accept(10)).isTrue();
    }
    assertThat(allow.accept(10)).isFalse();
    assertThat(allow.reason()).isEqualTo("too many messages");
  }

  @Test
  void theBudgetComesBackWithTheNextWindow() {
    Movable clock = new Movable();
    var allow = new Limits(clock, Limits.DEFAULT_MAX_UNAUTHENTICATED).allowance();
    for (int i = 0; i < Limits.MAX_PER_WINDOW + 1; i++) allow.accept(10);

    clock.pass(Limits.WINDOW_MS);
    assertThat(allow.accept(10)).isTrue();
  }

  @Test
  void socketsHaveSeparateBudgets() {
    // Per connection, because it has to work before we know who is on the
    // other end -- which is the window the auth deadline exists to close.
    Limits limits = new Limits();
    var a = limits.allowance();
    var b = limits.allowance();

    for (int i = 0; i < Limits.MAX_PER_WINDOW + 1; i++) a.accept(10);
    assertThat(a.accept(10)).isFalse();
    assertThat(b.accept(10)).isTrue();
  }

  @Test
  void aFloodOfStrangersIsRefusedWhereverItComesFrom() {
    // The set actually worth bounding. Authenticated players are already
    // capped at one socket per account, so the only unbounded group is sockets
    // that have not proved anything -- and nothing here cares which address
    // they arrive from, which is the point.
    Limits limits = new Limits(Clock.systemUTC(), Limits.DEFAULT_MAX_UNAUTHENTICATED);

    for (int i = 0; i < Limits.DEFAULT_MAX_UNAUTHENTICATED; i++) {
      assertThat(limits.enterLobby()).as("stranger %d", i).isTrue();
    }
    assertThat(limits.enterLobby()).isFalse();
    assertThat(limits.strangers()).isEqualTo(Limits.DEFAULT_MAX_UNAUTHENTICATED);

    // And they stop counting the moment they authenticate.
    for (int i = 0; i < 50; i++) limits.leaveLobby();
    assertThat(limits.enterLobby()).isTrue();
  }

  @Test
  void leavingMoreOftenThanArrivingCannotGoNegative() {
    Limits limits = new Limits();
    limits.leaveLobby();
    limits.leaveLobby();
    assertThat(limits.strangers()).isZero();
  }

  @Test
  void theDeadlineIsShortEnoughToBoundTheUnauthenticatedSet() {
    // With a deadline, the number of sockets that never authenticate stops
    // being unbounded and becomes (connections per second x this).
    assertThat(Duration.ofMillis(Limits.AUTH_DEADLINE_MS)).isLessThan(Duration.ofSeconds(30));
  }

}
