package io.github.excalibase.clashofpokemon.game.net;

import java.time.Clock;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** How much a socket may say, checked before anything reads it. */
@Component
public final class Limits {

  /** Generous: the largest honest message is an auth with a deck and a ticket. */
  public static final int MAX_FRAME_BYTES = 4096;

  /** Per second, per socket. A real client sends fewer than five. */
  static final int MAX_PER_WINDOW = 60;
  static final long WINDOW_MS = 1000;

  /** How long a socket may stay silent before it is asked to leave. */
  public static final long AUTH_DEADLINE_MS = 5_000;

  /** How many sockets node-wide may be unauthenticated at once. */
  static final int DEFAULT_MAX_UNAUTHENTICATED = 500;

  private final int maxUnauthenticated;
  private final Clock clock;
  private final AtomicInteger unauthenticated = new AtomicInteger();

  public Limits() {
    this(Clock.systemUTC(), DEFAULT_MAX_UNAUTHENTICATED);
  }

  @org.springframework.beans.factory.annotation.Autowired
  public Limits(@Value("${clash.max-unauthenticated:500}") int maxUnauthenticated) {
    this(Clock.systemUTC(), maxUnauthenticated);
  }

  public Limits(Clock clock, int maxUnauthenticated) {
    this.clock = clock;
    this.maxUnauthenticated = maxUnauthenticated;
  }

  /** One socket's budget. */
  public final class Allowance {
    private long windowStart = clock.millis();
    private int count;
    private String reason = "";

    /** False when this frame should be dropped without being read. */
    public boolean accept(int bytes) {
      if (bytes > MAX_FRAME_BYTES) {
        reason = "message too large";
        return false;
      }
      long now = clock.millis();
      if (now - windowStart >= WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      if (++count > MAX_PER_WINDOW) {
        reason = "too many messages";
        return false;
      }
      return true;
    }

    /** Why the last frame was refused, for the message sent back. */
    public String reason() {
      return reason;
    }
  }

  public Allowance allowance() {
    return new Allowance();
  }

  /** Take a place among the sockets that have not said who they are. */
  public boolean enterLobby() {
    while (true) {
      int now = unauthenticated.get();
      if (now >= maxUnauthenticated) return false;
      if (unauthenticated.compareAndSet(now, now + 1)) return true;
    }
  }

  /** It authenticated, or it left. Either way it is no longer a stranger. */
  public void leaveLobby() {
    unauthenticated.updateAndGet(n -> Math.max(0, n - 1));
  }

  public int strangers() {
    return unauthenticated.get();
  }
}
