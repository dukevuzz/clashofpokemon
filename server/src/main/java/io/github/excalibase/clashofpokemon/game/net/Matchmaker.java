package io.github.excalibase.clashofpokemon.game.net;

import io.github.excalibase.clashofpokemon.game.rules.Cards;
import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.random.RandomGenerator;

/** Who plays whom, and where they sit. */
@org.springframework.stereotype.Component
public final class Matchmaker {

  /** Somebody waiting to be seated, publicly or in a room they opened. */
  public record Waiting(Wire.Account account, List<String> deck, String troop,
                        String branch, Seat.Channel channel) {}

  /** Where an account is sitting, which outlives the socket that put it there. */
  public record Seated(Room room, Side side) {}

  // There is no limit on how long somebody may wait, on purpose.

  /** Somebody waiting, and since when. */
  private record Queued(Waiting who, long since) {}

  private final List<Queued> queue = new ArrayList<>();
  private final Invites<Waiting> invites;
  private final Map<String, Room> rooms = new ConcurrentHashMap<>();
  private final Map<String, Seated> seatOf = new ConcurrentHashMap<>();
  private final RandomGenerator rng;

  public Matchmaker() {
    this(RandomGenerator.getDefault(), new Invites<>(), report -> {});
  }

  /** The result of every finished match goes somewhere, and this is where that is decided. */
  @org.springframework.beans.factory.annotation.Autowired
  public Matchmaker(Reporter reporter) {
    this(RandomGenerator.getDefault(), new Invites<>(), reporter::report);
  }

  /** The generator decides seats and seeds, so a test can pin both. */
  public Matchmaker(RandomGenerator rng, Invites<Waiting> invites,
                    java.util.function.Consumer<Room.Report> onFinished) {
    this.rng = rng;
    this.invites = invites;
    this.onFinished = onFinished;
  }

  private final java.util.function.Consumer<Room.Report> onFinished;

  /** Why this deck cannot be played, or null. */
  public static String refuseDeck(List<String> wanted, String troop) {
    List<String> deck = new ArrayList<>();
    for (String id : wanted == null ? List.<String>of() : wanted) {
      if (Cards.byId(id) != null && Cards.all().contains(Cards.byId(id))) deck.add(id);
    }
    Set<String> distinct = new HashSet<>(deck);
    if (distinct.size() != deck.size()) return "a deck cannot hold the same card twice";
    if (deck.size() != Rules.config().deckSize()) {
      return "deck must be " + Rules.config().deckSize() + " cards you are allowed to choose";
    }
    // Same rule for the tower creature. Falling back to a default accepted an
    // unknown troop in silence, which is how a typo becomes a support ticket
    // about the wrong creature on somebody's tower.
    if (Rules.troops().stream().noneMatch(t -> t.id().equals(troop))) {
      return "no such tower creature: " + troop;
    }
    return null;
  }

  /** Match ids are random, not counted. */
  private String newRoomId() {
    return "m_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
  }

  /** Somebody is already playing here, so this is a reconnect. */
  public Seated seatOf(String accountId) {
    Seated at = seatOf.get(accountId);
    return at == null || at.room().finished() ? null : at;
  }

  /** Open a private room and name it. */
  public String openInvite(Waiting who) {
    return invites.open(who);
  }

  /** Join the room somebody opened, or null if that code is not one. */
  public Room joinInvite(String code, Waiting who) {
    Waiting host = invites.claim(code);
    return host == null ? null : seatTogether(host, who);
  }

  public void cancelInvite(Waiting who) {
    invites.cancel(w -> w == who);
  }

  /** Wait for whoever turns up next, and be seated if that is now. */
  public synchronized Room enqueue(Waiting who) {
    return enqueue(who, System.currentTimeMillis());
  }

  synchronized Room enqueue(Waiting who, long now) {
    queue.add(new Queued(who, now));
    // Never against yourself. One socket per account should make this
    // impossible; it is checked because "impossible" is how the last two of
    // these got in.
    for (int i = 0; i < queue.size(); i++) {
      for (int j = i + 1; j < queue.size(); j++) {
        if (queue.get(i).who().account().id().equals(queue.get(j).who().account().id())) {
          continue;
        }
        Waiting a = queue.remove(j).who();
        Waiting b = queue.remove(i).who();
        return seatTogether(b, a);
      }
    }
    return null;
  }

  public synchronized void leaveQueue(Waiting who) {
    queue.removeIf(q -> q.who() == who);
  }

  public synchronized int queued() {
    return queue.size();
  }

  public int running() {
    return (int) rooms.values().stream().filter(Room::running).count();
  }

  public List<Room> live() {
    return List.copyOf(rooms.values());
  }

  /** Sit two people down together. */
  public Room seatTogether(Waiting a, Waiting b) {
    boolean flip = rng.nextDouble() < 0.5;
    String id = newRoomId();

    Seat seatA = seat(a, flip ? Side.ONE : Side.TWO);
    Seat seatB = seat(b, flip ? Side.TWO : Side.ONE);

    Room room = new Room(id, seatA, seatB, rng.nextInt() & 0xffffffffL, true, this::retire);
    room.attach(seatA.side, a.channel());
    room.attach(seatB.side, b.channel());

    rooms.put(id, room);
    seatOf.put(a.account().id(), new Seated(room, seatA.side));
    seatOf.put(b.account().id(), new Seated(room, seatB.side));
    room.greet();
    return room;
  }

  private static Seat seat(Waiting who, Side side) {
    return new Seat(who.account(), side, who.deck(), who.troop(), who.branch());
  }

  /** A finished room is kept a little while, then let go. */
  private void retire(Room room) {
    // The room's own clock rather than this one's, so every wait in the
    // server is measured against the same time the host loop hands out.
    finished.add(new Finished(room, room.endedAt()));
    // Records are the meta tier's to keep, not this one's. Reported the moment
    // the match ends rather than when the room is swept, because the sweep is
    // thirty seconds later and a node that restarts in between would lose it.
    onFinished.accept(room.report());
  }

  private record Finished(Room room, long at) {}

  private final List<Finished> finished =
      java.util.Collections.synchronizedList(new ArrayList<>());

  static final long KEEP_FINISHED_MS = 30_000;

  /** Called by the host loop. */
  public void sweep(long now) {
    for (Room room : live()) room.sweep(now);

    synchronized (finished) {
      finished.removeIf(f -> {
        if (now - f.at() < KEEP_FINISHED_MS) return false;
        rooms.remove(f.room().id);
        seatOf.values().removeIf(at -> at.room() == f.room());
        f.room().dispose();
        return true;
      });
    }
  }
}
