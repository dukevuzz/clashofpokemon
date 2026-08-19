package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Autowired;

/** Leaving without taking the matches with you. */
// A fresh application per test, which is unusual and necessary here.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    // Not four minutes: the drain hook waits for matches to finish, and a
    // test that leaves one running would hold the JVM open until it gave up.
    properties = "clash.drain-timeout-ms=2000")
@org.springframework.test.annotation.DirtiesContext(
    classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class DrainTest {

  @Autowired private Drain drain;
  @Autowired private Matchmaker matchmaker;
  @Autowired private Status status;
  @Autowired private ApplicationAvailability availability;
  @Autowired private org.springframework.beans.factory.config.ConfigurableListableBeanFactory
      beanFactory;

  private static final List<String> DECK =
      List.of("machop", "charmander", "squirtle", "geodude", "pidgey", "litwick");

  private static Matchmaker.Waiting who(String id) {
    return new Matchmaker.Waiting(new Wire.Account(id, id), DECK,
        Rules.troops().getFirst().id(), null, new Seat.Channel() {
          @Override public void send(Wire.Msg m) {}

          @Override public void sendBinary(byte[] f) {}
        });
  }

  @Test
  void aHealthyNodeIsAcceptingTraffic() {
    assertThat(drain.draining()).isFalse();
    assertThat(status.status().get("draining")).isEqualTo(false);
    assertThat(availability.getReadinessState()).isEqualTo(ReadinessState.ACCEPTING_TRAFFIC);
  }

  @Test
  void drainingRefusesTrafficWithoutClaimingToBeUnwell() {
    // Liveness is deliberately untouched: a node winding down is not sick, and
    // a platform that restarts it would cut every match it is protecting.
    matchmaker.enqueue(who("ana"));
    Room room = matchmaker.enqueue(who("bo"));
    room.loaded(room.seat(Side.ONE), 0);
    room.loaded(room.seat(Side.TWO), 0);
    assertThat(room.running()).isTrue();

    // The match is still going, so this would ordinarily block -- run it on a
    // thread and check the readiness flag flips first, which is the part a
    // deploy depends on.
    Thread draining = new Thread(drain::drain);
    draining.setDaemon(true);
    draining.start();

    // Wait on the readiness state rather than the flag: the flag is set a
    // line earlier, so watching it can catch the moment in between and report
    // a node that says it is draining while still advertising for traffic.
    long deadline = System.currentTimeMillis() + 5000;
    while (availability.getReadinessState() != ReadinessState.REFUSING_TRAFFIC
        && System.currentTimeMillis() < deadline) {
      Thread.onSpinWait();
    }

    assertThat(drain.draining()).isTrue();
    assertThat(availability.getReadinessState()).isEqualTo(ReadinessState.REFUSING_TRAFFIC);
    assertThat(status.status().get("draining")).isEqualTo(true);

    // And it is still hosting the match it already had.
    assertThat(room.running()).isTrue();
    room.leave(room.seat(Side.ONE), 1000);
    draining.interrupt();
  }

  @Test
  void anEmptyNodeLeavesImmediately() {
    // Nothing in progress, so there is nothing to wait for -- a deploy on an
    // idle node should not sit for four minutes.
    long before = System.currentTimeMillis();
    drain.drain();
    assertThat(System.currentTimeMillis() - before).isLessThan(2000);
    assertThat(drain.draining()).isTrue();
  }

  @Test
  void theWaitIsLongerThanAMatchCanPossiblyBe() {
    // If this ever drops below the match length, a deploy starts cutting
    // matches short and the symptom is players losing games at random.
    assertThat(Drain.DEFAULT_WAIT_MS).isGreaterThan((long) Rules.config().matchSeconds() * 1000);
  }


  @Test
  void theDrainIsDestroyedBeforeTheLoopThatFinishesMatches() {
    /*
     * The ordering a shutdown depends on, asserted where it is decided.
     *
     * Spring destroys beans in reverse creation order, so the drain must be
     * *created after* the loop to be *destroyed before* it. Unordered, the
     * loop stopped first and the drain then waited four minutes for matches
     * nothing was advancing, gave up, and cut them -- the exact outcome it
     * exists to prevent, while logging that it had waited politely.
     *
     * Checked as a dependency rather than by watching a shutdown, because the
     * first version of this test did the latter and passed with the bug still
     * in place: a loop that is running normally proves nothing about the
     * order it is stopped in. This fails the moment somebody removes the
     * constructor parameter, which is the only thing holding the order.
     */
    List<String> dependencies = List.of(beanFactory.getDependenciesForBean("drain"));
    assertThat(dependencies)
        .as("drain must depend on matchLoop, or it is destroyed first")
        .contains("matchLoop");
  }
}
