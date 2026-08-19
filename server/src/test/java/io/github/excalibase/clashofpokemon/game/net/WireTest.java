package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** The packed snapshot, checked against the bytes the TypeScript actually writes. */
class WireTest {

  private static final JsonNode ROOT = load();

  private static JsonNode load() {
    try (InputStream in = WireTest.class.getClassLoader().getResourceAsStream("wire.json")) {
      if (in == null) {
        throw new IllegalStateException("wire.json missing -- run `npm run export:wire`");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("wire fixture unreadable", e);
    }
  }

  @Test
  void bothEndsNumberTheCardsTheSameWay() {
    // The handshake refuses a client whose table differs, so this hash failing
    // means every real client would be turned away -- or worse, would not be.
    JsonNode table = ROOT.get("cardTable");
    assertThat(CardTable.size()).isEqualTo(table.get("size").intValue());
    assertThat(CardTable.idAt(0)).isEqualTo(table.get("first").stringValue());
    assertThat(CardTable.idAt(CardTable.size() - 1))
        .isEqualTo(table.get("last").stringValue());
    assertThat(CardTable.contentHash()).isEqualTo(ROOT.get("contentHash").stringValue());
  }

  @Test
  void theTableIsAStableTwoWayMapping() {
    for (int i = 0; i < CardTable.size(); i++) {
      assertThat(CardTable.indexOf(CardTable.idAt(i))).isEqualTo(i);
    }
    assertThat(CardTable.indexOf(null)).isEqualTo(CardTable.NO_CARD);
    assertThat(CardTable.idAt(CardTable.NO_CARD)).isNull();
    assertThat(CardTable.cardAt(0)).isNotNull();
  }

  @Test
  void anUnknownCardIsRefusedRatherThanSentAsSomethingElse() {
    assertThatThrownBy(() -> CardTable.indexOf("not-a-card"));
  }

  private static void assertThatThrownBy(Runnable r) {
    org.assertj.core.api.Assertions.assertThatThrownBy(r::run)
        .isInstanceOf(IllegalArgumentException.class);
  }

  @TestFactory
  List<DynamicTest> everySnapshotPacksToTheSameBytes() {
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonNode c : ROOT.get("cases")) {
      tests.add(DynamicTest.dynamicTest(c.get("name").stringValue(), () -> {
        Snapshot.Snap snap = read(c.get("snap"));
        byte[] packed = Snapshot.encode(snap);

        assertThat(hex(packed))
            .as("packed bytes")
            .isEqualTo(c.get("bytes").stringValue());
        assertThat(packed.length)
            .as("sizeOf must agree with what encode wrote")
            .isEqualTo(Snapshot.sizeOf(snap));
      }));
    }
    return tests;
  }

  @TestFactory
  List<DynamicTest> everySnapshotReadsBackToWhatWasSent() {
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonNode c : ROOT.get("cases")) {
      tests.add(DynamicTest.dynamicTest(c.get("name").stringValue(), () -> {
        byte[] bytes = unhex(c.get("bytes").stringValue());
        Snapshot.Snap back = Snapshot.decode(bytes);
        JsonNode want = c.get("snap");

        assertThat(back.tick()).isEqualTo(want.get("tick").longValue());
        assertThat(back.units()).hasSize(want.get("u").size());
        assertThat(back.towers()).hasSize(want.get("w").size());
        assertThat(back.shots()).hasSize(want.get("p").size());
        assertThat(back.me().hand()).hasSize(want.get("me").get("hand").size());

        // Positions survive to a tenth, which is a fortieth of a creature.
        for (int i = 0; i < back.units().size(); i++) {
          JsonNode u = want.get("u").get(i);
          assertThat(back.units().get(i).id()).isEqualTo(u.get(0).intValue());
          assertThat(back.units().get(i).x())
              .isCloseTo(u.get(1).doubleValue(), org.assertj.core.data.Offset.offset(0.05));
        }
        // The hand comes back as cards, not numbers -- including the holes.
        for (int i = 0; i < back.me().hand().size(); i++) {
          JsonNode held = want.get("me").get("hand").get(i);
          assertThat(back.me().hand().get(i))
              .isEqualTo(held.isNull() ? null : held.stringValue());
        }
      }));
    }
    return tests;
  }

  @Test
  void aUnitIdThatWillNotFitIsRefusedRatherThanTruncated() {
    // Truncating would turn one creature into another with no error anywhere.
    Snapshot.Snap snap = new Snapshot.Snap(0, 10,
        List.of(new Snapshot.UnitSnap(0x10000, 0, 0, 1, 0, 0, 0, 0, 0)),
        List.of(), List.of(), new Snapshot.Own(0, List.of(), null));

    org.assertj.core.api.Assertions.assertThatThrownBy(() -> Snapshot.encode(snap))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("does not fit");
  }

  @Test
  void statusBitsSurviveTheRoundTripInOrder() {
    // Both ends encode a status set the same way, or statuses render as noise.
    List<String> all = Protocol.STATUS_BITS;
    assertThat(Protocol.bitsToStatus(Protocol.statusBits(all))).isEqualTo(all);
    assertThat(Protocol.statusBits(List.of("not-a-status"))).isZero();
    assertThat(Protocol.bitsToStatus(0)).isEmpty();
    assertThat(Protocol.statusBits(List.of("burn"))).isEqualTo(1 << 4);
  }

  @Test
  void anUnknownActionStandsStillRatherThanWalking() {
    assertThat(Protocol.actionCode("Walk")).isZero();
    assertThat(Protocol.actionCode("Attack")).isEqualTo(2);
    assertThat(Protocol.actionCode("Sunbathe")).isEqualTo(Protocol.ACTIONS.indexOf("Idle"));
  }

  // --------------------------------------------------------------- plumbing

  private static Snapshot.Snap read(JsonNode s) {
    List<Snapshot.UnitSnap> units = new ArrayList<>();
    for (JsonNode u : s.get("u")) {
      units.add(new Snapshot.UnitSnap(u.get(0).intValue(), u.get(1).doubleValue(),
          u.get(2).doubleValue(), u.get(3).intValue(), u.get(4).intValue(),
          u.get(5).intValue(), u.get(6).intValue(), u.get(7).doubleValue(),
          u.get(8).intValue()));
    }
    List<Snapshot.TowerSnap> towers = new ArrayList<>();
    for (JsonNode w : s.get("w")) {
      towers.add(new Snapshot.TowerSnap(w.get(0).intValue(), w.get(1).intValue(),
          w.get(2).intValue(), w.get(3).doubleValue(), w.get(4).intValue()));
    }
    List<Snapshot.ShotSnap> shots = new ArrayList<>();
    for (JsonNode p : s.get("p")) {
      shots.add(new Snapshot.ShotSnap(p.get(0).doubleValue(), p.get(1).doubleValue()));
    }
    List<String> hand = new ArrayList<>();
    for (JsonNode h : s.get("me").get("hand")) hand.add(h.isNull() ? null : h.stringValue());
    JsonNode next = s.get("me").get("next");

    return new Snapshot.Snap(s.get("tick").longValue(), s.get("left").doubleValue(),
        units, towers, shots,
        new Snapshot.Own(s.get("me").get("e").doubleValue(), hand,
            next.isNull() ? null : next.stringValue()));
  }

  private static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b));
    return sb.toString();
  }

  private static byte[] unhex(String s) {
    byte[] out = new byte[s.length() / 2];
    for (int i = 0; i < out.length; i++) {
      out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
}
