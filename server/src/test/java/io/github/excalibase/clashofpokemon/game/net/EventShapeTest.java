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
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Every event, checked against the shape the client declares. */
class EventShapeTest {

  private static final ObjectMapper JSON = JsonMapper.builder().build();
  private static final JsonNode ROOT = load();

  private static JsonNode load() {
    try (InputStream in = EventShapeTest.class.getClassLoader()
        .getResourceAsStream("events.json")) {
      if (in == null) {
        throw new IllegalStateException("events.json missing -- run `npm run export:events`");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("event fixture unreadable", e);
    }
  }

  /** One of every event the rules can raise, translated as the room does it. */
  private static Map<String, Wire.Event> everyEvent() {
    Match.Options o = new Match.Options();
    o.rng = Room.mulberry32(3);
    Match m = new Match(o);

    Unit a = Deploy.spawn(m, Cards.byId("charmander"), Side.ONE, 100, 500);
    Unit b = Deploy.spawn(m, Cards.byId("machop"), Side.TWO, 100, 300);
    Tower t = m.towers.getFirst();

    List<MatchEvent> raised = List.of(
        new MatchEvent.Spawn(a),
        new MatchEvent.Ready(a),
        new MatchEvent.Hit(b, 42, 2, a),
        new MatchEvent.Cast(a, b, "EMBER"),
        new MatchEvent.Afflicted(b, StatusKind.BURN, 3.5),
        new MatchEvent.Shot(a, b, 12, 1.5),
        new MatchEvent.Death(b),
        new MatchEvent.TowerDown(t),
        new MatchEvent.KingWakes(t),
        new MatchEvent.Evolve(Side.ONE, Cards.byId("charmander"), Cards.byId("charmeleon")),
        new MatchEvent.Choice(Side.TWO, "c1", Cards.byId("eevee"),
            List.of(Cards.byId("espeon"), Cards.byId("umbreon"))),
        new MatchEvent.Over("one"));

    Map<String, Wire.Event> byKind = new HashMap<>();
    for (MatchEvent e : raised) {
      for (Wire.Event wire : Wire.toWire(e)) byKind.put(wire.e(), wire);
    }
    return byKind;
  }

  @Test
  void everyEventCarriesExactlyTheFieldsTheClientReads() {
    Map<String, Wire.Event> ours = everyEvent();

    for (JsonNode expected : ROOT.get("events")) {
      String kind = expected.get("kind").stringValue();
      Wire.Event event = ours.get(kind);
      assertThat(event).as("no Java event of kind %s", kind).isNotNull();

      List<String> want = new ArrayList<>();
      for (JsonNode f : expected.get("fields")) want.add(f.stringValue());

      // Sorted on both sides: this is about which fields exist, not the order
      // a record happens to declare them in.
      JsonNode written = JSON.readTree(JSON.writeValueAsString(event));
      List<String> got = new ArrayList<>(new TreeSet<>(written.propertyNames()));

      assertThat(got).as("fields of %s", kind).isEqualTo(want);
    }
  }

  @Test
  void theClientKnowsEveryEventTheRulesCanRaise() {
    // The other direction: an event this server can send that the client has
    // never heard of is one the client silently discards.
    List<String> declared = new ArrayList<>();
    for (JsonNode e : ROOT.get("events")) declared.add(e.get("kind").stringValue());

    assertThat(everyEvent().keySet()).containsExactlyInAnyOrderElementsOf(declared);
  }

  @Test
  void theFieldsThatNameCardsHoldCardIds() {
    // The specific confusion that caused this: `from` is a card id in evolve
    // and choice, and a unit id in hit and shot. Same name, different things,
    // which is why one record could not carry them all.
    Map<String, Wire.Event> ours = everyEvent();

    JsonNode evolve = JSON.readTree(JSON.writeValueAsString(ours.get("evolve")));
    assertThat(evolve.get("from").stringValue()).isEqualTo("charmander");
    assertThat(evolve.get("to").stringValue()).isEqualTo("charmeleon");

    JsonNode choice = JSON.readTree(JSON.writeValueAsString(ours.get("choice")));
    assertThat(choice.get("from").stringValue()).isEqualTo("eevee");
    assertThat(choice.get("id").stringValue()).isEqualTo("c1");
    assertThat(choice.get("options").valueStream().map(JsonNode::stringValue).toList())
        .containsExactly("espeon", "umbreon");

    JsonNode hit = JSON.readTree(JSON.writeValueAsString(ours.get("hit")));
    assertThat(hit.get("from").isNumber()).as("a unit id, not a card id").isTrue();
  }
}
