package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Cards;
import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** One match, hosted for two people. */
class RoomTest {

  /** A socket that remembers everything said to it. */
  private static final class Recorder implements Seat.Channel {
    final List<Wire.Msg> messages = new ArrayList<>();
    final List<byte[]> frames = new ArrayList<>();

    @Override public void send(Wire.Msg message) {
      messages.add(message);
    }

    @Override public void sendBinary(byte[] frame) {
      frames.add(frame);
    }

    <T> List<T> of(Class<T> type) {
      return messages.stream().filter(type::isInstance).map(type::cast).toList();
    }

    <T> T last(Class<T> type) {
      List<T> all = of(type);
      return all.isEmpty() ? null : all.getLast();
    }
  }

  private static final List<String> DECK = List.of(
      "machop", "charmander", "squirtle", "geodude",
      "pidgey", "litwick", "spheal", "diglett");

  private Recorder one;
  private Recorder two;

  private Room room() {
    return room(true);
  }

  private Room room(boolean packed) {
    one = new Recorder();
    two = new Recorder();
    Seat a = new Seat(new Wire.Account("ana", "Ana"), Side.ONE, DECK, troop(), null);
    Seat b = new Seat(new Wire.Account("bo", "Bo"), Side.TWO, DECK, troop(), null);
    Room r = new Room("m1", a, b, 7, packed, x -> {});
    r.attach(Side.ONE, one);
    r.attach(Side.TWO, two);
    return r;
  }

  private static String troop() {
    return Rules.troops().getFirst().id();
  }

  private static Room started(Room r) {
    r.loaded(r.seat(Side.ONE), 1000);
    r.loaded(r.seat(Side.TWO), 1000);
    return r;
  }

  // ----------------------------------------------------------------- opening

  @Test
  void bothSeatsAreToldWhoTheyAreAndWhatBothDecksAre() {
    // The decks travel in the greeting, not in `start`. A client told them
    // only at `start` would have no art to load, would never report ready,
    // and `start` would never come -- two browsers drawing black squares.
    Room r = room();
    r.greet();

    Wire.Hello hello = one.last(Wire.Hello.class);
    assertThat(hello).isNotNull();
    assertThat(hello.you()).isEqualTo("ana");
    assertThat(hello.seat()).isEqualTo(Side.ONE.wire());
    assertThat(hello.me().deck()).isEqualTo(DECK);
    assertThat(hello.them().id()).isEqualTo("bo");
    assertThat(hello.them().deck()).isEqualTo(DECK);
    assertThat(hello.tick()).isEqualTo(Protocol.TICK_HZ);
    assertThat(hello.snap()).isEqualTo(Protocol.SNAP_HZ);
  }

  @Test
  void theMatchWaitsForBothSeatsToLoad() {
    // A loading gate rather than a countdown: without it the player on a slow
    // phone starts the match already behind.
    Room r = room();
    r.loaded(r.seat(Side.ONE), 1000);
    assertThat(r.running()).isFalse();
    assertThat(one.of(Wire.Start.class)).isEmpty();

    r.loaded(r.seat(Side.TWO), 1000);
    assertThat(r.running()).isTrue();
    assertThat(one.of(Wire.Start.class)).hasSize(1);
    assertThat(two.of(Wire.Start.class)).hasSize(1);
  }

  @Test
  void theSameSeedIsSentToBothSeats() {
    // The seed is the server's to choose: a client that picked it would be
    // choosing its own draws.
    Room r = started(room());
    assertThat(one.last(Wire.Start.class).seed())
        .isEqualTo(two.last(Wire.Start.class).seed())
        .isEqualTo(r.seed);
  }

  // ------------------------------------------------------------------ playing

  @Test
  void aPlayBeforeTheStartIsRefusedAndNamed() {
    Room r = room();
    r.deploy(r.seat(Side.ONE), 1, 0, 144, 560, null);

    Wire.Reject no = one.last(Wire.Reject.class);
    assertThat(no).isNotNull();
    assertThat(no.code()).isEqualTo("notstarted");
    assertThat(no.seq()).isEqualTo(1);
  }

  @Test
  void aPlayYouCannotAffordIsRefusedAsElixir() {
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 0.0);
    r.deploy(r.seat(Side.ONE), 2, 0, 144, 560, null);

    assertThat(one.last(Wire.Reject.class).code()).isEqualTo("elixir");
  }

  @Test
  void aSlotThatIsNotThereIsRefusedAsSlot() {
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 10.0);
    r.deploy(r.seat(Side.ONE), 3, 99, 144, 560, null);

    assertThat(one.last(Wire.Reject.class).code()).isEqualTo("slot");
  }

  @Test
  void aPlayInTheirHalfIsRefusedAsZone() {
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 10.0);
    r.deploy(r.seat(Side.ONE), 4, 0, 144, 60, null);

    assertThat(one.last(Wire.Reject.class).code()).isEqualTo("zone");
  }

  @Test
  void aLegalPlayIsAcceptedSilentlyAndPutsSomethingOnTheBoard() {
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 10.0);
    r.deploy(r.seat(Side.ONE), 5, 0, 144, 560, null);

    assertThat(one.of(Wire.Reject.class)).isEmpty();
    assertThat(r.match.units).isNotEmpty();
  }

  @Test
  void aClientCannotPlayFromTheOtherSeatsHand() {
    // The seat comes from the socket, never from the message -- so there is no
    // field to lie in.
    Room r = started(room());
    r.match.elixir.put(Side.TWO, 10.0);
    r.deploy(r.seat(Side.TWO), 6, 0, 144, 110, null);

    assertThat(r.match.units).allSatisfy(u -> assertThat(u.side).isEqualTo(Side.TWO));
  }

  @Test
  void anAnswerToAnOfferThatIsNotOpenIsRefusedAsStale() {
    Room r = started(room());
    r.choose(r.seat(Side.ONE), 7, "c9", "espeon");
    assertThat(one.last(Wire.Reject.class).code()).isEqualTo("stale");
  }

  @Test
  void aPingIsAnsweredWithItsOwnNumberAndTheCurrentTick() {
    Room r = started(room());
    for (int i = 0; i < 10; i++) r.step(2000);
    r.ping(r.seat(Side.ONE), 42);

    Wire.Pong pong = one.last(Wire.Pong.class);
    assertThat(pong.c()).isEqualTo(42);
    assertThat(pong.tick()).isEqualTo(r.tick());
  }

  // --------------------------------------------------------------- the stream

  @Test
  void aSnapshotGoesOutFifteenTimesASecondAndIsPacked() {
    Room r = started(room());
    for (int i = 0; i < Protocol.TICK_HZ; i++) r.step(2000);

    assertThat(one.frames).hasSize(Protocol.SNAP_HZ);
    assertThat(two.frames).hasSize(Protocol.SNAP_HZ);
    // Readable on request, because that is how the deck-ordering deadlock was
    // found -- and the two must describe the same board.
    assertThat(Snapshot.decode(one.frames.getFirst()).towers()).hasSize(6);
  }

  @Test
  void aReadableSnapshotIsSentWhenPackingIsOff() {
    Room r = started(room(false));
    for (int i = 0; i < Protocol.TICKS_PER_SNAP; i++) r.step(2000);

    assertThat(one.frames).isEmpty();
    assertThat(one.of(Wire.Snap.class)).hasSize(1);
  }

  @Test
  void bothPlayersSeeTheSameBoardAndOnlyTheirOwnHand() {
    // The only fog in this game is the opponent's hand, which is why one
    // serialisation of the board serves both players.
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 10.0);
    r.deploy(r.seat(Side.ONE), 1, 0, 144, 560, null);
    for (int i = 0; i < Protocol.TICKS_PER_SNAP; i++) r.step(2000);

    Snapshot.Snap mine = Snapshot.decode(one.frames.getLast());
    Snapshot.Snap theirs = Snapshot.decode(two.frames.getLast());

    assertThat(mine.units()).isEqualTo(theirs.units());
    assertThat(mine.towers()).isEqualTo(theirs.towers());
    assertThat(mine.me().hand()).isNotEqualTo(theirs.me().hand());
  }

  @Test
  void aSpawnIsAnnouncedExactlyOnce() {
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 10.0);
    r.deploy(r.seat(Side.ONE), 1, 0, 144, 560, null);
    for (int i = 0; i < 90; i++) r.step(2000);

    long spawns = one.of(Wire.Ev.class).stream()
        .flatMap(ev -> ev.e().stream())
        .filter(e -> "spawn".equals(e.e()))
        .count();
    assertThat(spawns).isEqualTo(1);
  }

  @Test
  void anEvolutionOfferGoesToTheSeatItBelongsTo() {
    // Sending it to both showed the opponent a dialog for a card they do not
    // own *and* told them an evolution was happening -- a tell they had not
    // earned.
    Room r = started(room());
    var offerCard = Cards.all().stream()
        .filter(c -> io.github.excalibase.clashofpokemon.game.rules.Evolution.offerFor(c.id(), r.match.rng) != null)
        .findFirst().orElse(null);
    org.junit.jupiter.api.Assumptions.assumeTrue(offerCard != null, "no branching card");

    // Put the offer straight into the match, then let one broadcast carry it.
    r.match.hand.get(Side.ONE).set(0, offerCard);
    for (int i = 0; i < io.github.excalibase.clashofpokemon.game.rules.Evolution.playsNeeded(offerCard); i++) {
      r.match.hand.get(Side.ONE).set(0, offerCard);
      r.match.elixir.put(Side.ONE, 10.0);
      r.match.deploy(Side.ONE, 0, 144, 560);
    }
    for (int i = 0; i < Protocol.TICKS_PER_SNAP; i++) r.step(2000);

    assertThat(choices(one)).isNotEmpty();
    assertThat(choices(two)).isEmpty();
  }

  private static List<Wire.Event> choices(Recorder r) {
    return r.of(Wire.Ev.class).stream()
        .flatMap(ev -> ev.e().stream())
        .filter(e -> "choice".equals(e.e()))
        .toList();
  }

  // ------------------------------------------------------- leaving and coming back

  @Test
  void theMatchDoesNotStopWhenSomebodyDisconnects() {
    // A real-time match that pauses on demand is one where whoever pauses
    // thinks for free.
    Room r = started(room());
    r.setLive(Side.TWO, false);

    long before = r.tick();
    for (int i = 0; i < 30; i++) r.step(2000);
    assertThat(r.tick()).isGreaterThan(before);
    assertThat(r.running()).isTrue();
    // And the one still watching is told.
    assertThat(one.last(Wire.Peer.class).state()).isEqualTo("disconnected");
  }

  @Test
  void comingBackGivesTheWholeBoardRatherThanTheDifference() {
    // The alternative is a "here is what you missed" path that only runs after
    // something has gone wrong, and therefore only breaks after that too.
    Room r = started(room());
    r.match.elixir.put(Side.ONE, 10.0);
    r.deploy(r.seat(Side.ONE), 1, 0, 144, 560, null);
    for (int i = 0; i < 30; i++) r.step(2000);

    Recorder back = new Recorder();
    r.setLive(Side.TWO, false);
    r.attach(Side.TWO, back);
    r.resync(r.seat(Side.TWO));

    assertThat(back.of(Wire.Hello.class)).hasSize(1);
    assertThat(back.of(Wire.Start.class)).hasSize(1);
    long spawns = back.of(Wire.Ev.class).stream()
        .flatMap(ev -> ev.e().stream()).filter(e -> "spawn".equals(e.e())).count();
    assertThat(spawns).isEqualTo(r.match.units.size());
  }

  @Test
  void leavingHandsTheMatchToTheOtherSeat() {
    Room r = started(room());
    r.leave(r.seat(Side.ONE), 5000);

    assertThat(r.finished()).isTrue();
    assertThat(one.last(Wire.Over.class).youWon()).isFalse();
    assertThat(two.last(Wire.Over.class).youWon()).isTrue();
    assertThat(r.report().outcome()).isEqualTo("team2");
    assertThat(r.report().reason()).isEqualTo("forfeit");
  }

  @Test
  void aFinishedMatchStopsSteppingAndIsReportedOnce() {
    Room r = started(room());
    var ended = new java.util.concurrent.atomic.AtomicInteger();
    Room counted = new Room("m2",
        new Seat(new Wire.Account("ana", "Ana"), Side.ONE, DECK, troop(), null),
        new Seat(new Wire.Account("bo", "Bo"), Side.TWO, DECK, troop(), null),
        7, true, x -> ended.incrementAndGet());
    counted.loaded(counted.seat(Side.ONE), 0);
    counted.loaded(counted.seat(Side.TWO), 0);

    // Run the clock out. A match is three minutes at thirty frames a second.
    int frames = (int) (Rules.config().matchSeconds() * Protocol.TICK_HZ) + 60;
    for (int i = 0; i < frames; i++) counted.step(1000);

    assertThat(counted.finished()).isTrue();
    assertThat(ended.get()).isEqualTo(1);
    long tick = counted.tick();
    counted.step(1000);
    assertThat(counted.tick()).isEqualTo(tick);
    assertThat(r.report().contentVersion()).isEqualTo(Cards.version());
  }

  @Test
  void aResultIsReportedInTheBoardsLanguageRatherThanTheScreens() {
    // "player" and "enemy" are words about which end of the arena somebody sat
    // at. Seat one is team one today; a 2v2 is the same message with four.
    Room r = started(room());
    r.leave(r.seat(Side.TWO), 9000);

    Room.Report report = r.report();
    assertThat(report.outcome()).isEqualTo("team1");
    assertThat(report.players()).hasSize(2);
    assertThat(report.players().getFirst().team()).isEqualTo(1);
    assertThat(report.matchId()).isEqualTo("m1");
  }

  // ------------------------------------------------------------------ the deck

  @Test
  void aDeckOfEvolvedCardsIsRefusedRatherThanBuilt() {
    // Charizard has 454 health against Charmander's 156, and every evolved
    // form builds perfectly well -- which is exactly why naming one must not
    // be enough to get one.
    List<String> cheating = List.of("charizard", "blastoise", "machamp", "golem",
        "pidgeot", "machop", "spheal", "diglett");
    assertThat(Room.deckOf(cheating).stream().map(io.github.excalibase.clashofpokemon.game.rules.Card::id))
        .containsExactly("machop", "spheal", "diglett");
  }

  @Test
  void aDeckNamingTheSameCardTwiceGetsItOnce() {
    assertThat(Room.deckOf(List.of("machop", "machop", "spheal"))).hasSize(2);
  }

  @Test
  void aDeckNamingSomethingThatDoesNotExistIsSimplyShorter() {
    assertThat(Room.deckOf(List.of("machop", "definitely-not-a-card"))).hasSize(1);
  }
}
