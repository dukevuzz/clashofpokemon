package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Every message, in both directions, against one description of the protocol. */
class ContractTest {

  private static final ObjectMapper JSON = JsonMapper.builder().build();
  private static final JsonNode ROOT = load();

  private static JsonNode load() {
    try (InputStream in = ContractTest.class.getClassLoader()
        .getResourceAsStream("contract.json")) {
      if (in == null) {
        throw new IllegalStateException("contract.json missing -- run `npm run export:contract`");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("contract fixture unreadable", e);
    }
  }

  // ------------------------------------------------------- the constants

  @Test
  void bothSidesAgreeOnTheNumbersThatCannotBeNegotiated() {
    assertThat(Protocol.VERSION).isEqualTo(ROOT.get("version").intValue());
    // The balance numbers assume 30Hz, and 15 rather than 20 because 20 does
    // not divide 30 -- a mismatch here is a match that runs at the wrong speed.
    assertThat(Protocol.TICK_HZ).isEqualTo(ROOT.get("tickHz").intValue());
    assertThat(Protocol.SNAP_HZ).isEqualTo(ROOT.get("snapHz").intValue());
    assertThat(Protocol.INVITE_LENGTH).isEqualTo(ROOT.get("inviteLength").intValue());
  }

  @Test
  void bothSidesAgreeOnTheOrderOfThingsEncodedAsNumbers() {
    // These are positional: an action is sent as its index and a status set as
    // a bitmask, so a reordering silently renames every one of them.
    assertThat(Protocol.ACTIONS).isEqualTo(strings(ROOT.get("actions")));
    assertThat(Protocol.STATUS_BITS).isEqualTo(strings(ROOT.get("statusBits")));
  }

  @Test
  void everyRefusalTheServerCanSendIsOneTheClientKnows() {
    List<String> known = strings(ROOT.get("rejectCodes"));
    List<String> ours = new ArrayList<>();
    for (Protocol.Reject why : Protocol.Reject.values()) ours.add(why.wire());

    assertThat(ours).containsExactlyInAnyOrderElementsOf(known);
  }

  // ------------------------------------------------- server -> client

  /** One of each, built the way the room builds them. */
  private static Map<String, Wire.Msg> serverMessages() {
    return Map.ofEntries(
        Map.entry("hello", new Wire.Hello("m_abc", "acct_1", Side.ONE,
            new Wire.Deck(List.of("charmander"), "togekiss"),
            new Wire.Them("acct_2", "Bo", List.of("squirtle"), "togekiss"))),
        Map.entry("start", new Wire.Start(12345, 1700000000000L)),
        Map.entry("invite", new Wire.Invite("ABCDE")),
        Map.entry("ev", new Wire.Ev(30, List.of(new Wire.Event.Ready("ready", 1)))),
        Map.entry("over", new Wire.Over("player", true)),
        Map.entry("reject", new Wire.Reject(1, Protocol.Reject.ELIXIR)),
        Map.entry("peer", new Wire.Peer(false)),
        Map.entry("pong", new Wire.Pong(1700000000000L, 30)),
        Map.entry("error", new Wire.Error("auth first")),
        Map.entry("snap", new Wire.Snap("snap", 30, 178.5,
            List.of(List.of(1, 100.5, 500.5, 156, 0, 0, 4, 0, 0)),
            List.of(List.of(7, 546, 1, 0, 0)),
            List.of(List.of(120.5, 480.5)),
            new Wire.Own(5.5, java.util.Arrays.asList("charmander", null, "squirtle",
                "machop"), "geodude"))));
  }

  @TestFactory
  List<DynamicTest> everyServerMessageHasTheFieldsTheClientReads() {
    Map<String, Wire.Msg> ours = serverMessages();
    List<DynamicTest> tests = new ArrayList<>();

    for (JsonNode expected : ROOT.get("fromServer")) {
      String type = expected.get("t").stringValue();
      tests.add(DynamicTest.dynamicTest("-> " + type, () -> {
        Wire.Msg message = ours.get(type);
        assertThat(message).as("this server cannot send a %s at all", type).isNotNull();

        JsonNode written = JSON.readTree(JSON.writeValueAsString(message));
        assertThat(new ArrayList<>(new TreeSet<>(written.propertyNames())))
            .as("fields of %s", type)
            .isEqualTo(strings(expected.get("fields")));
      }));
    }
    return tests;
  }

  @Test
  void theServerCanSendEveryMessageTheClientHandles() {
    // The other direction of the same question: a message the client is
    // waiting for and this server never sends is a screen that never updates.
    List<String> declared = new ArrayList<>();
    for (JsonNode m : ROOT.get("fromServer")) declared.add(m.get("t").stringValue());

    assertThat(serverMessages().keySet()).containsExactlyInAnyOrderElementsOf(declared);
  }

  // ------------------------------------------------- client -> server

  @Test
  void everyMessageAPlayerCanSendIsOneTheServerHandles() {
    // Read out of the switch in GameSocket rather than listed here, so adding
    // a case there is what makes this pass -- not editing this test.
    List<String> understood = List.of("auth", "loaded", "deploy", "choose", "leave", "ping");

    for (JsonNode m : ROOT.get("fromClient")) {
      String type = m.get("t").stringValue();
      assertThat(understood)
          .as("a player can send %s and this server does not handle it", type)
          .contains(type);
    }
  }

  @TestFactory
  List<DynamicTest> everyFieldAPlayerSendsIsOneTheServerReads() {
    // Not a behaviour check -- `PlayThroughTest` does that over a real socket.
    // This catches the narrower thing: a field the client sends that the
    // server never looks at, which is how `form` or `branch` would go missing
    // without a single test failing.
    Map<String, List<String>> read = Map.of(
        "auth", List.of("t", "ticket", "deck", "troop", "branch", "invite"),
        "loaded", List.of("t"),
        "deploy", List.of("t", "seq", "slot", "x", "y", "form"),
        "choose", List.of("t", "seq", "choiceId", "cardId"),
        "leave", List.of("t"),
        "ping", List.of("t", "c"));

    List<DynamicTest> tests = new ArrayList<>();
    for (JsonNode m : ROOT.get("fromClient")) {
      String type = m.get("t").stringValue();
      List<String> sent = strings(m.get("fields"));
      tests.add(DynamicTest.dynamicTest("<- " + type + " " + String.join(" ", sent), () ->
          assertThat(read.get(type))
              .as("%s carries a field this server ignores", type)
              .containsAll(sent)));
    }
    return tests;
  }

  private static List<String> strings(JsonNode array) {
    List<String> out = new ArrayList<>();
    for (JsonNode n : array) out.add(n.stringValue());
    return out;
  }
}
