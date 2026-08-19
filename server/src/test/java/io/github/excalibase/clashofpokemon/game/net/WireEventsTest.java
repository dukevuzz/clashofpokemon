package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Cards;
import io.github.excalibase.clashofpokemon.game.rules.Deploy;
import io.github.excalibase.clashofpokemon.game.rules.Match;
import io.github.excalibase.clashofpokemon.game.rules.MatchEvent;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import io.github.excalibase.clashofpokemon.game.rules.StatusKind;
import io.github.excalibase.clashofpokemon.game.rules.Tower;
import io.github.excalibase.clashofpokemon.game.rules.Unit;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Turning what happened into something a client can read. */
class WireEventsTest {

  private static final ObjectMapper JSON = JsonMapper.builder().build();

  private static Match match() {
    Match.Options o = new Match.Options();
    o.rng = Room.mulberry32(3);
    return new Match(o);
  }

  private static Unit unit(Match m, String card, Side side) {
    Unit u = Deploy.spawn(m, Cards.byId(card), side, 100, 500);
    u.spawning = 0;
    return u;
  }

  private static String json(MatchEvent e) {
    List<Wire.Event> wire = Wire.toWire(e);
    assertThat(wire).hasSize(1);
    return JSON.writeValueAsString(wire.getFirst());
  }

  @Test
  void aSpawnCarriesEnoughToDrawTheCreature() {
    // The card is named once and every snapshot after that is nine numbers --
    // which only works if this message says which card it was.
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE);
    String out = json(new MatchEvent.Spawn(u));

    assertThat(out).contains("\"e\":\"spawn\"").contains("\"card\":\"machop\"")
        .contains("\"id\":" + u.id).contains("\"side\":1").contains("\"arrive\":");
  }

  @Test
  void aHitNamesWhoWasHitAndByWhom() {
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO);
    Unit source = unit(m, "charmander", Side.ONE);
    String out = json(new MatchEvent.Hit(target, 42, 2.0, source));

    assertThat(out).contains("\"e\":\"hit\"").contains("\"amount\":42")
        .contains("\"mult\":2.0").contains("\"from\":" + source.id);
  }

  @Test
  void aHitFromNobodyIsStillAHit() {
    // Burn and poison have no attacker, and a translation that assumed one
    // would drop the only damage in the game that nothing causes.
    Match m = match();
    Unit u = unit(m, "machop", Side.TWO);
    assertThat(json(new MatchEvent.Hit(u, 5, 1, null))).contains("\"e\":\"hit\"");
  }

  @Test
  void aCastNamesTheMoveAndWhatItWasAimedAt() {
    Match m = match();
    Unit u = unit(m, "charmander", Side.ONE);
    Unit at = unit(m, "machop", Side.TWO);
    String out = json(new MatchEvent.Cast(u, at, "EMBER"));

    assertThat(out).contains("\"skill\":\"EMBER\"").contains("\"at\":" + at.id);
  }

  @Test
  void aStatusNamesItselfInTheSpellingTheClientKnows() {
    Match m = match();
    Unit u = unit(m, "machop", Side.TWO);
    String out = json(new MatchEvent.Afflicted(u, StatusKind.ARMOR_BREAK, 3.5));

    assertThat(out).contains("\"kind\":\"armorBreak\"").contains("\"seconds\":3.5");
    // And the spelling is the one the snapshot's bit order uses.
    assertThat(Protocol.STATUS_BITS).contains("armorBreak");
  }

  @Test
  void aDeathSaysWhetherItWasATower() {
    Match m = match();
    Unit u = unit(m, "machop", Side.TWO);
    Tower t = m.towers.getFirst();

    assertThat(json(new MatchEvent.Death(u))).contains("\"tower\":false");
    assertThat(json(new MatchEvent.Death(t))).contains("\"tower\":true");
  }

  @Test
  void aTowerFallingAndAKingWakingAreBothJustAnId() {
    Match m = match();
    Tower t = m.towers.getFirst();
    assertThat(json(new MatchEvent.TowerDown(t))).contains("\"e\":\"towerDown\"")
        .contains("\"id\":" + t.id);
    assertThat(json(new MatchEvent.KingWakes(t))).contains("\"e\":\"kingWakes\"");
  }

  @Test
  void anEvolutionNamesBothCards() {
    String out = json(new MatchEvent.Evolve(Side.ONE,
        Cards.byId("charmander"), Cards.byId("charmeleon")));
    // `from` and `to`, not `fromCard`/`toCard`. This test asserted the latter
    // for a while, which is how it passed while the client -- reading
    // `e.from` -- dropped every evolution on the floor.
    assertThat(out).contains("\"from\":\"charmander\"")
        .contains("\"to\":\"charmeleon\"").contains("\"side\":1");
  }

  @Test
  void aBranchOfferCarriesTheOptionsAndTheOfferId() {
    // Answered by name, naming the offer -- so both have to survive the trip.
    String out = json(new MatchEvent.Choice(Side.TWO, "c1", Cards.byId("eevee"),
        List.of(Cards.byId("espeon"), Cards.byId("umbreon"))));

    assertThat(out).contains("\"id\":\"c1\"").contains("\"from\":\"eevee\"")
        .contains("\"side\":2").contains("\"espeon\"").contains("\"umbreon\"");
  }

  @Test
  void theResultIsTranslatedFromSeatsToEndsOfTheArena() {
    // The rules say "one" and "two" and never have to be relabelled per
    // socket; the screen says "player" and "enemy".
    assertThat(json(new MatchEvent.Over("one"))).contains("\"result\":\"player\"");
    assertThat(json(new MatchEvent.Over("two"))).contains("\"result\":\"enemy\"");
    assertThat(json(new MatchEvent.Over("draw"))).contains("\"result\":\"draw\"");
  }

  @Test
  void aReadyIsTheMomentAnArrivalFinishes() {
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE);
    assertThat(json(new MatchEvent.Ready(u))).contains("\"e\":\"ready\"")
        .contains("\"id\":" + u.id);
  }

  @Test
  void aShotNamesBothEndsSoItCanBeDrawnFlying() {
    Match m = match();
    Unit from = unit(m, "squirtle", Side.ONE);
    Unit to = unit(m, "machop", Side.TWO);
    String out = json(new MatchEvent.Shot(from, to, 12, 1.5));

    assertThat(out).contains("\"from\":" + from.id).contains("\"to\":" + to.id)
        .contains("\"amount\":12");
  }

  @Test
  void aGreetingSerialisesWithTheFieldNamesTheClientExpects() {
    Wire.Hello hello = new Wire.Hello("m_1", "ana", Side.TWO,
        new Wire.Deck(List.of("machop"), "togekiss"),
        new Wire.Them("bo", "Bo", List.of("machop"), "togekiss"));

    String out = JSON.writeValueAsString(hello);
    assertThat(out).contains("\"t\":\"hello\"").contains("\"matchId\":\"m_1\"")
        .contains("\"you\":\"ana\"").contains("\"seat\":2")
        .contains("\"v\":" + Protocol.VERSION);
  }

  @Test
  void everyRefusalHasALowerCaseNameOnTheWire() {
    for (Protocol.Reject why : Protocol.Reject.values()) {
      assertThat(why.wire()).isLowerCase().isNotBlank();
    }
    assertThat(JSON.writeValueAsString(new Wire.Reject(3, Protocol.Reject.NOTSTARTED)))
        .contains("\"code\":\"notstarted\"").contains("\"seq\":3");
  }
}
