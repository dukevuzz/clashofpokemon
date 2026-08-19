package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** When to stop waiting for somebody. */
class GivingUpTest {

  private static final List<String> DECK = List.of(
      "machop", "charmander", "squirtle", "geodude", "pidgey", "litwick");

  /** A socket that notices when it is hung up on. */
  private static final class Recorder implements Seat.Channel {
    final List<Wire.Msg> messages = new ArrayList<>();
    String closedBecause;

    @Override public void send(Wire.Msg message) {
      messages.add(message);
    }

    @Override public void sendBinary(byte[] frame) {}

    @Override public void close(String why) {
      closedBecause = why;
    }

    <T> T last(Class<T> type) {
      List<T> all = messages.stream().filter(type::isInstance).map(type::cast).toList();
      return all.isEmpty() ? null : all.getLast();
    }
  }

  private Recorder one;
  private Recorder two;

  private Room room() {
    one = new Recorder();
    two = new Recorder();
    Room r = new Room("m1",
        new Seat(new Wire.Account("ana", "Ana"), Side.ONE, DECK, troop(), null),
        new Seat(new Wire.Account("bo", "Bo"), Side.TWO, DECK, troop(), null),
        7, true, x -> {});
    r.attach(Side.ONE, one);
    r.attach(Side.TWO, two);
    return r;
  }

  private static String troop() {
    return Rules.troops().getFirst().id();
  }

  // ------------------------------------------------------- the loading gate

  @Test
  void aPlayerWhoIsStillLoadingIsWaitedFor() {
    // 270 sprite sheets on hotel wifi is not idleness -- they are connected
    // and working. The long grace is for this, and only this.
    Room r = room();
    r.sweep(0);
    r.sweep(Room.LOADING_GRACE_MS - 1);

    assertThat(r.running()).isFalse();
    assertThat(r.finished()).isFalse();
    r.loaded(r.seat(Side.ONE), 1);
    r.loaded(r.seat(Side.TWO), 1);
    assertThat(r.running()).isTrue();
  }

  @Test
  void aPlayerWhoDropsBeforeTheStartGetsLongEnoughToReload() {
    // A different situation and a much shorter wait: nothing is loading,
    // because nobody is there. What this buys is a page reload -- and the
    // person who *is* sitting there ready should not be kept much longer
    // than that for somebody who may not be coming back.
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.sweep(0);
    r.setLive(Side.TWO, false);
    r.sweep(1000);

    assertThat(r.running()).as("still time to come back").isFalse();
    r.sweep(1000 + Room.RELOAD_GRACE_MS + 1);
    assertThat(r.running()).isTrue();
  }

  @Test
  void reloadingInTimeResetsTheWait() {
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.sweep(0);
    r.setLive(Side.TWO, false);
    r.sweep(1000);

    r.attach(Side.TWO, two);
    r.sweep(1000 + Room.RELOAD_GRACE_MS + 1);
    // Back, and loading -- so the long grace applies again, not the short one.
    assertThat(r.running()).isFalse();
    assertThat(r.finished()).isFalse();
  }

  @Test
  void comingBackBeforeTheStartDoesNotSkipLoading() {
    // The reconnect path marks a seat loaded, which is right for a match
    // already in progress -- the board is live whether your art is or not.
    // Before the start it is wrong: it would begin the match while the player
    // who just reloaded is still fetching sprite sheets, which is precisely
    // the disadvantage the loading gate exists to prevent.
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.setLive(Side.TWO, false);
    r.rejoin(r.seat(Side.TWO), 100);

    assertThat(r.running()).as("waiting for their art, not their socket").isFalse();
    r.loaded(r.seat(Side.TWO), 200);
    assertThat(r.running()).isTrue();
  }

  @Test
  void comingBackMidMatchDoesNotWaitForLoading() {
    // The other half of the same rule: the match is already running, so there
    // is nothing to gate. Marking them loaded is what lets `resync` hand them
    // the whole board immediately.
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.loaded(r.seat(Side.TWO), 0);
    r.setLive(Side.TWO, false);
    r.rejoin(r.seat(Side.TWO), 100);

    assertThat(r.running()).isTrue();
    assertThat(r.seat(Side.TWO).loaded()).isTrue();
  }

  @Test
  void aMatchStartsAnywayIfOneSideNeverLoads() {
    // The player who is there should get their match. The one who is not
    // loses by not turning up, which is far better than both being stuck.
    Room r = room();
    r.sweep(0);
    r.loaded(r.seat(Side.ONE), 1);
    r.sweep(Room.LOADING_GRACE_MS + 1);

    assertThat(r.running()).isTrue();
    assertThat(r.finished()).isFalse();
    assertThat(one.last(Wire.Start.class)).isNotNull();
  }

  @Test
  void aMatchNobodyLoadsIsAbandonedRatherThanHeldForever() {
    // The bug this whole file exists for: without it, both accounts stay
    // seated in a room that can never start, and reconnect into it forever.
    Room r = room();
    r.sweep(0);
    r.sweep(Room.LOADING_GRACE_MS + 1);

    assertThat(r.finished()).isTrue();
    assertThat(r.running()).isFalse();
    assertThat(r.report().reason()).isEqualTo("abandoned");
    assertThat(r.report().outcome()).isEqualTo("draw");
  }

  @Test
  void bothDroppingBeforeTheStartIsAbandonedQuickly() {
    // Nobody is loading and nobody is there. Waiting the full grace for two
    // absent people helps neither of them.
    Room r = room();
    r.sweep(0);
    r.setLive(Side.ONE, false);
    r.setLive(Side.TWO, false);
    // The clock starts when the host notices they are gone, which in
    // production is the next frame -- thirty times a second.
    r.sweep(1000);
    r.sweep(1000 + Room.RELOAD_GRACE_MS + 1);

    assertThat(r.finished()).isTrue();
    assertThat(r.report().outcome()).isEqualTo("draw");
  }

  @Test
  void anAbandonedMatchIsNotHeldAgainstEitherPlayer() {
    // Neither of them played, so neither of them lost. A forfeit here would
    // punish whoever's connection dropped first.
    Room r = room();
    r.sweep(0);
    r.sweep(Room.LOADING_GRACE_MS + 1);

    assertThat(r.report().outcome()).isEqualTo("draw");
    assertThat(one.last(Wire.Over.class).youWon()).isFalse();
    assertThat(two.last(Wire.Over.class).youWon()).isFalse();
  }

  // --------------------------------------------------------- both sides gone

  @Test
  void aMatchKeepsRunningWhileOnePlayerIsAway() {
    // Time passing while you are gone is the cost of being gone. This is the
    // rule the whole server is built around and nothing here may weaken it.
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.loaded(r.seat(Side.TWO), 0);
    r.setLive(Side.TWO, false);

    for (int i = 0; i < 30; i++) r.step(Room.AWAY_GRACE_MS * 2);
    r.sweep(Room.AWAY_GRACE_MS * 2);
    assertThat(r.finished()).isFalse();
    assertThat(r.tick()).isEqualTo(30);
  }

  @Test
  void aMatchNobodyIsWatchingIsGivenUpOn() {
    // Both gone and neither coming back: this is simulating a board for an
    // audience of nobody, on a tick loop shared with every other match.
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.loaded(r.seat(Side.TWO), 0);
    r.setLive(Side.ONE, false);
    r.setLive(Side.TWO, false);

    r.sweep(1000);
    assertThat(r.finished()).as("not yet -- they may be reconnecting").isFalse();

    r.sweep(1000 + Room.AWAY_GRACE_MS + 1);
    assertThat(r.finished()).isTrue();
    assertThat(r.report().reason()).isEqualTo("abandoned");
  }

  @Test
  void comingBackResetsTheClockOnGivingUp() {
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.loaded(r.seat(Side.TWO), 0);
    r.setLive(Side.ONE, false);
    r.setLive(Side.TWO, false);
    r.sweep(1000);

    r.attach(Side.ONE, one);
    r.sweep(1000 + Room.AWAY_GRACE_MS + 1);
    assertThat(r.finished()).isFalse();
  }

  @Test
  void aFinishedMatchIsNotFinishedTwice() {
    Room r = room();
    r.loaded(r.seat(Side.ONE), 0);
    r.loaded(r.seat(Side.TWO), 0);
    r.leave(r.seat(Side.ONE), 100);

    r.sweep(100 + Room.AWAY_GRACE_MS * 3);
    assertThat(one.messages.stream().filter(Wire.Over.class::isInstance)).hasSize(1);
  }

  // ---------------------------------------------------------------- the queue

  @Test
  void somebodyWaitingIsLeftToWait() {
    // No limit, on purpose. A quiet server is not a broken one, the player can
    // cancel whenever they like, and they hold nothing but their own socket.
    // A socket whose owner has actually gone is a different problem, solved by
    // the client's heartbeat and the idle timeout rather than by a stopwatch
    // here.
    Matchmaker m = matchmaker();
    m.enqueue(waiting("ana"), 0);

    m.sweep(60 * 60_000);
    assertThat(m.queued()).isEqualTo(1);
  }

  @Test
  void beingPairedStopsTheClockOnWaiting() {
    Matchmaker m = matchmaker();
    m.enqueue(waiting("ana"), 0);
    assertThat(m.enqueue(waiting("bo"), 0)).isNotNull();

    m.sweep(60 * 60_000);
    assertThat(m.queued()).isZero();
  }

  @Test
  void aRoomThatIsSweptAwayFreesTheSeatsInIt() {
    // The point of all of this: the account can play again afterwards.
    Matchmaker m = matchmaker();
    m.enqueue(waiting("ana"), 0);
    Room room = m.enqueue(waiting("bo"), 0);

    // The grace runs from when the host first sees the room, which in
    // production is the very next frame -- thirty times a second.
    m.sweep(0);
    m.sweep(Room.LOADING_GRACE_MS + 1);
    assertThat(room.finished()).isTrue();

    m.sweep(Room.LOADING_GRACE_MS + Matchmaker.KEEP_FINISHED_MS + 2);
    assertThat(m.seatOf("ana")).isNull();
    assertThat(m.seatOf("bo")).isNull();
  }

  private static Matchmaker matchmaker() {
    return new Matchmaker(java.util.random.RandomGenerator.getDefault(),
        new Invites<>(), r -> {});
  }

  private static Matchmaker.Waiting waiting(String id) {
    return new Matchmaker.Waiting(new Wire.Account(id, id), DECK, troop(), null,
        new Recorder());
  }
}
