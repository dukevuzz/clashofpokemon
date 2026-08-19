package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

/** Who plays whom, and where they sit. */
class MatchmakerTest {

  /** A legal deck: exactly `deckSize` cards a deck is allowed to hold. */
  private static final List<String> DECK = List.of(
      "machop", "charmander", "squirtle", "geodude", "pidgey", "litwick");

  private static final Seat.Channel NOWHERE = new Seat.Channel() {
    @Override public void send(Wire.Msg message) {}

    @Override public void sendBinary(byte[] frame) {}
  };

  private static Matchmaker.Waiting who(String id) {
    return new Matchmaker.Waiting(new Wire.Account(id, id), DECK,
        Rules.troops().getFirst().id(), null, NOWHERE);
  }

  private static Matchmaker maker() {
    return new Matchmaker(java.util.random.RandomGenerator.getDefault(), new Invites<>(), r -> {});
  }

  // ------------------------------------------------------------- the queue

  @Test
  void oneWaitingPlayerIsNotAMatch() {
    Matchmaker m = maker();
    assertThat(m.enqueue(who("ana"))).isNull();
    assertThat(m.queued()).isEqualTo(1);
    assertThat(m.running()).isZero();
  }

  @Test
  void twoWaitingPlayersBecomeAMatch() {
    Matchmaker m = maker();
    m.enqueue(who("ana"));
    Room room = m.enqueue(who("bo"));

    assertThat(room).isNotNull();
    assertThat(m.queued()).isZero();
    assertThat(m.seatOf("ana")).isNotNull();
    assertThat(m.seatOf("bo")).isNotNull();
    assertThat(m.seatOf("ana").side()).isNotEqualTo(m.seatOf("bo").side());
  }

  @Test
  void nobodyIsEverMatchedAgainstThemselves() {
    // One socket per account should make this impossible; it is checked
    // because "impossible" is how the last two of these got in.
    Matchmaker m = maker();
    assertThat(m.enqueue(who("ana"))).isNull();
    assertThat(m.enqueue(who("ana"))).isNull();
    assertThat(m.queued()).isEqualTo(2);

    // Somebody else arriving pairs with one of them and leaves the other.
    assertThat(m.enqueue(who("bo"))).isNotNull();
    assertThat(m.queued()).isEqualTo(1);
  }

  @Test
  void leavingTheQueueTakesYouOutOfIt() {
    Matchmaker m = maker();
    Matchmaker.Waiting ana = who("ana");
    m.enqueue(ana);
    m.leaveQueue(ana);

    assertThat(m.queued()).isZero();
    assertThat(m.enqueue(who("bo"))).isNull();
  }

  @Test
  void seatsAreDealtAtRandomRatherThanByArrival() {
    // If seat one carries any advantage -- a rounding in the deploy zone, the
    // order a tie breaks -- handing it to whoever queued first is something
    // players would learn to exploit.
    List<Side> firstArrival = new ArrayList<>();
    for (int i = 0; i < 40; i++) {
      Matchmaker m = maker();
      m.enqueue(who("ana"));
      m.enqueue(who("bo"));
      firstArrival.add(m.seatOf("ana").side());
    }
    assertThat(firstArrival).contains(Side.ONE).contains(Side.TWO);
  }

  // ------------------------------------------------------- the private room

  @Test
  void aPrivateRoomSeatsThePairThatChoseEachOther() {
    Matchmaker m = maker();
    String code = m.openInvite(who("ana"));

    assertThat(code).hasSize(Protocol.INVITE_LENGTH);
    Room room = m.joinInvite(code, who("bo"));
    assertThat(room).isNotNull();
    assertThat(m.seatOf("ana")).isNotNull();
    assertThat(m.seatOf("bo")).isNotNull();
    // And it did not touch the public queue on the way.
    assertThat(m.queued()).isZero();
  }

  @Test
  void aCodeNobodyOpenedIsNotARoom() {
    Matchmaker m = maker();
    assertThat(m.joinInvite("ZZZZZ", who("bo"))).isNull();
  }

  @Test
  void aRoomIsGoodForOneGuest() {
    Matchmaker m = maker();
    String code = m.openInvite(who("ana"));
    assertThat(m.joinInvite(code, who("bo"))).isNotNull();
    assertThat(m.joinInvite(code, who("cy"))).isNull();
  }

  @Test
  void aHostWhoLeavesTakesTheRoomWithThem() {
    // A code that outlived the intent behind it seats a stranger who guessed it.
    Matchmaker m = maker();
    Matchmaker.Waiting ana = who("ana");
    String code = m.openInvite(ana);
    m.cancelInvite(ana);

    assertThat(m.joinInvite(code, who("bo"))).isNull();
  }

  @Test
  void aPrivateMatchIsTheSameMatchAsAPublicOne() {
    // The difference between them is only how the pair was chosen. Two code
    // paths would be two chances for them to diverge.
    Matchmaker m = maker();
    String code = m.openInvite(who("ana"));
    Room privateRoom = m.joinInvite(code, who("bo"));

    Matchmaker n = maker();
    n.enqueue(who("cy"));
    Room publicRoom = n.enqueue(who("di"));

    assertThat(privateRoom.match.towers).hasSize(publicRoom.match.towers.size());
    assertThat(privateRoom.running()).isEqualTo(publicRoom.running());
    assertThat(privateRoom.id).startsWith("m_").isNotEqualTo(publicRoom.id);
  }

  @Test
  void matchIdsAreRandomRatherThanCounted() {
    // Counting gives away how many matches this server has ever run, and a
    // list of every other id.
    Matchmaker m = maker();
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < 20; i++) {
      m.enqueue(who("a" + i));
      Room room = m.enqueue(who("b" + i));
      ids.add(room.id);
    }
    assertThat(ids).doesNotHaveDuplicates();
    assertThat(ids).allSatisfy(id -> assertThat(id).hasSize("m_".length() + 12));
  }

  // ------------------------------------------------------------- reconnects

  @Test
  void aSeatOutlivesTheSocketThatMadeIt() {
    Matchmaker m = maker();
    m.enqueue(who("ana"));
    Room room = m.enqueue(who("bo"));
    room.setLive(Side.ONE, false);

    assertThat(m.seatOf("ana")).isNotNull();
    assertThat(m.seatOf("ana").room()).isSameAs(room);
  }

  @Test
  void aFinishedMatchIsKeptBrieflyAndThenLetGo() {
    // Long enough that somebody reconnecting into a match that just ended is
    // told the result rather than dropped into a new queue.
    Matchmaker m = maker();
    m.enqueue(who("ana"));
    Room room = m.enqueue(who("bo"));
    room.loaded(room.seat(Side.ONE), 0);
    room.loaded(room.seat(Side.TWO), 0);
    room.leave(room.seat(Side.ONE), 1000);

    assertThat(m.live()).contains(room);
    m.sweep(1000 + Matchmaker.KEEP_FINISHED_MS - 1);
    assertThat(m.live()).contains(room);

    m.sweep(System.currentTimeMillis() + Matchmaker.KEEP_FINISHED_MS + 1);
    assertThat(m.live()).doesNotContain(room);
    assertThat(m.seatOf("ana")).isNull();
  }

  // ------------------------------------------------------------- the deck

  @Test
  void anHonestDeckIsAccepted() {
    assertThat(Matchmaker.refuseDeck(DECK, Rules.troops().getFirst().id())).isNull();
  }

  @Test
  void aDeckOfEvolvedCardsIsRefusedWithAReason() {
    // Every evolved form builds perfectly well, which is exactly why naming
    // one must not be enough to get one.
    List<String> cheating = List.of("charizard", "blastoise", "machamp",
        "golem", "pidgeot", "gengar");
    assertThat(Matchmaker.refuseDeck(cheating, Rules.troops().getFirst().id()))
        .contains("allowed to choose");
  }

  @Test
  void aDeckOfTheWrongSizeIsRefused() {
    assertThat(Matchmaker.refuseDeck(DECK.subList(0, 3), Rules.troops().getFirst().id()))
        .isNotNull();
    assertThat(Matchmaker.refuseDeck(null, Rules.troops().getFirst().id())).isNotNull();
  }

  @Test
  void aDeckHoldingOneCardTwiceIsRefusedAndSaysSo() {
    List<String> doubled = new ArrayList<>(DECK.subList(0, DECK.size() - 1));
    doubled.add("machop");
    assertThat(Matchmaker.refuseDeck(doubled, Rules.troops().getFirst().id()))
        .isEqualTo("a deck cannot hold the same card twice");
  }

  @Test
  void anUnknownTowerCreatureIsRefusedRatherThanQuietlyReplaced() {
    // Falling back to a default is how a typo becomes a support ticket about
    // the wrong creature on somebody's tower.
    assertThat(Matchmaker.refuseDeck(DECK, "not-a-troop")).contains("no such tower creature");
    assertThat(Matchmaker.refuseDeck(DECK, null)).contains("no such tower creature");
  }
}
