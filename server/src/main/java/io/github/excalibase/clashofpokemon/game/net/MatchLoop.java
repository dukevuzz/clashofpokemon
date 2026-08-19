package io.github.excalibase.clashofpokemon.game.net;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** The clock every match on this node runs on. */
@Component
public final class MatchLoop implements AutoCloseable {

  private static final Logger log = LoggerFactory.getLogger(MatchLoop.class);

  /** A frame is 33ms; this is the point at which the node is behind. */
  private static final long SLOW_FRAME_MS = 25;

  private final Matchmaker matchmaker;
  private final ScheduledExecutorService clock =
      Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "match-loop");
        t.setDaemon(true);
        return t;
      });

  public MatchLoop(Matchmaker matchmaker) {
    this.matchmaker = matchmaker;
    long period = 1000 / Protocol.TICK_HZ;
    clock.scheduleAtFixedRate(this::frame, period, period, TimeUnit.MILLISECONDS);
  }

  /** One frame for every running match. Package-visible so a test can drive it. */
  void frame() {
    long now = System.currentTimeMillis();
    try {
      for (Room room : matchmaker.live()) {
        if (room.running()) room.step(now);
      }
      // Sweeping every frame is thirty times a second more often than
      // anything here needs, and cheaper than deciding when to do it: the
      // work is a comparison per room and per queued player.
      matchmaker.sweep(now);
    } catch (RuntimeException e) {
      // One bad room must not stop the clock for every other match on the node.
      log.error("match loop frame failed", e);
    }
    long spent = System.currentTimeMillis() - now;
    if (spent > SLOW_FRAME_MS) log.warn("slow frame: {}ms for {} matches", spent, matchmaker.running());
  }

  @Override
  public void close() {
    clock.shutdownNow();
  }
}
