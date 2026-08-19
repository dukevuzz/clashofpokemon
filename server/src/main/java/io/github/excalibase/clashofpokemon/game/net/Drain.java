package io.github.excalibase.clashofpokemon.game.net;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.availability.AvailabilityChangeEvent;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

/** Going away without taking the matches with you. */
@Component
public class Drain {

  private static final Logger log = LoggerFactory.getLogger(Drain.class);

  /** Longer than a match, with room for the last result to be reported. */
  static final long DEFAULT_WAIT_MS = 240_000;

  private final ApplicationContext context;
  private final Matchmaker matchmaker;
  private final long maxWaitMs;
  private volatile boolean draining;

  /*
   * Takes the loop as a dependency it never calls.
   *
   * Spring destroys beans in reverse order of creation, so this is what
   * guarantees the loop is still running while we wait for the matches it is
   * stepping. Without it the two were unordered, and on the first real Docker
   * shutdown the loop stopped first: five matches were waited on for the full
   * four minutes, nothing advanced them, and the deploy killed them anyway.
   * A drain that can never succeed is worse than none, because it looks like
   * it worked.
   */
  public Drain(ApplicationContext context, Matchmaker matchmaker, MatchLoop loop,
      @org.springframework.beans.factory.annotation.Value(
          "${clash.drain-timeout-ms:240000}") long maxWaitMs) {
    this.context = context;
    this.matchmaker = matchmaker;
    this.maxWaitMs = maxWaitMs;
  }

  /** True once this node has stopped taking new players. */
  public boolean draining() {
    return draining;
  }

  /** Stop taking new players, and wait for the ones here to finish. */
  @PreDestroy
  public void drain() {
    if (draining) return;
    draining = true;
    // Readiness first, so the balancer stops sending people here before we
    // start counting down. Liveness is untouched -- this node is not sick.
    AvailabilityChangeEvent.publish(context, ReadinessState.REFUSING_TRAFFIC);

    int left = matchmaker.running();
    if (left == 0) {
      log.info("draining: nothing in progress, leaving now");
      return;
    }

    log.info("draining: waiting for {} match(es) to finish", left);
    long deadline = System.currentTimeMillis() + maxWaitMs;
    while (System.currentTimeMillis() < deadline) {
      left = matchmaker.running();
      if (left == 0) {
        log.info("draining: all matches finished");
        return;
      }
      try {
        Thread.sleep(250);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      }
    }
    // A match cannot outlast the clock, so arriving here means something is
    // stuck rather than merely slow. Say so: leaving quietly would make it
    // look like a clean deploy.
    log.error("draining: gave up with {} match(es) still running", matchmaker.running());
  }
}
