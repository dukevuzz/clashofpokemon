package io.github.excalibase.clashofpokemon.game.net;

import java.time.Clock;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import java.util.random.RandomGenerator;

/** Playing with somebody you chose. */
public final class Invites<T> {

  /** Long enough to be worth opening, short enough that nobody waits. */
  static final long LIFETIME_MS = 10 * 60_000;

  public record Waiting<T>(String code, T who, long opened) {}

  private final Map<String, Waiting<T>> rooms = new ConcurrentHashMap<>();
  private final Clock clock;
  private final RandomGenerator rng;

  public Invites() {
    this(Clock.systemUTC(), RandomGenerator.getDefault());
  }

  /** Clock and generator are injected so a test can expire a room and name one. */
  public Invites(Clock clock, RandomGenerator rng) {
    this.clock = clock;
    this.rng = rng;
  }

  /** Open a room and name it. */
  public String open(T who) {
    expire();
    for (int attempt = 0; attempt < 10; attempt++) {
      String code = code();
      if (rooms.putIfAbsent(code, new Waiting<>(code, who, clock.millis())) == null) {
        return code;
      }
    }
    throw new IllegalStateException("could not find a free invite code");
  }

  /** Take the room, if it is there. Claiming it removes it. */
  public T claim(String code) {
    expire();
    if (code == null) return null;
    // Typed by a person, so a lowercase code is the same code.
    Waiting<T> room = rooms.remove(code.trim().toUpperCase(java.util.Locale.ROOT));
    return room == null ? null : room.who();
  }

  /** Give up a room its owner left. */
  public void cancel(Predicate<T> owner) {
    for (Iterator<Waiting<T>> it = rooms.values().iterator(); it.hasNext(); ) {
      if (owner.test(it.next().who())) it.remove();
    }
  }

  public int size() {
    expire();
    return rooms.size();
  }

  private void expire() {
    long cutoff = clock.millis() - LIFETIME_MS;
    rooms.values().removeIf(room -> room.opened() < cutoff);
  }

  private String code() {
    StringBuilder out = new StringBuilder(Protocol.INVITE_LENGTH);
    for (int i = 0; i < Protocol.INVITE_LENGTH; i++) {
      out.append(Protocol.INVITE_ALPHABET.charAt(
          (int) Math.floor(rng.nextDouble() * Protocol.INVITE_ALPHABET.length())));
    }
    return out.toString();
  }
}
