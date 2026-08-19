package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import org.assertj.core.data.Offset;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Five whole matches, played twice -- once in TypeScript, once here. */
class DifferentialTest {

  /** Health is compared exactly, because it turns out to be exact. */
  private static final double HP_TOLERANCE = 0;

  /** Position, in pixels, and this one genuinely cannot be zero. */
  private static final double POSITION_TOLERANCE = 1.0;

  private static final JsonNode ROOT = load();

  /** Accumulated across a match, compared once at the end. See `compare`. */
  private List<String> struck = new ArrayList<>();
  private List<String> expectedStruck = new ArrayList<>();

  private static JsonNode load() {
    try (InputStream in = DifferentialTest.class.getClassLoader()
        .getResourceAsStream("differential.json")) {
      if (in == null) {
        throw new IllegalStateException(
            "differential.json missing -- run `npm run export:differential` in phaser/");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("differential fixture unreadable", e);
    }
  }

  /** The generator the TypeScript ran. Ported bit for bit; see mulberryMatches. */
  static RandomGenerator mulberry32(int seed) {
    return new RandomGenerator() {
      private int a = seed;

      @Override
      public double nextDouble() {
        a = a + 0x6d2b79f5;
        int t = a;
        t = (t ^ (t >>> 15)) * (1 | t);
        t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
        return ((t ^ (t >>> 14)) & 0xffffffffL) / 4294967296.0;
      }

      @Override
      public long nextLong() {
        return (long) (nextDouble() * Long.MAX_VALUE);
      }
    };
  }

  @TestFactory
  List<DynamicTest> everyMatchPlaysTheSameInBothEngines() {
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonNode fixture : ROOT.get("matches")) {
      int seed = fixture.get("seed").intValue();
      tests.add(DynamicTest.dynamicTest("seed " + seed, () -> replay(fixture)));
    }
    return tests;
  }

  /** Every card the fixture says was dealt. Decks differ per match now. */
  private static List<Card> deckOf(JsonNode ids) {
    List<Card> deck = new ArrayList<>();
    for (JsonNode id : ids) {
      Card c = Cards.byId(id.stringValue());
      assertThat(c).as("no such card: %s", id.stringValue()).isNotNull();
      deck.add(c);
    }
    return deck;
  }

  private void replay(JsonNode fixture) {
    Match.Options opts = new Match.Options();
    opts.rng = mulberry32(fixture.get("seed").intValue());
    opts.deckOne = deckOf(fixture.get("deckOne"));
    opts.deckTwo = deckOf(fixture.get("deckTwo"));
    opts.shuffle = false;      // the deal is not under test; the rules are
    opts.bot = java.util.Map.of();   // the script plays both sides, nobody improvises
    Match match = new Match(opts);

    JsonNode plays = fixture.get("plays");
    JsonNode checkpoints = fixture.get("checkpoints");
    int next = 0;
    int checked = 0;
    List<String> hits = new ArrayList<>();
    struck = new ArrayList<>();
    expectedStruck = new ArrayList<>();
    int limit = (int) (Rules.config().matchSeconds() * 30) + 60;

    for (int step = 0; step < limit && match.over == null; step++) {
      // By frame, not by elapsed time: two independently accumulated sums of
      // 1/30 are not the same number, and comparing them applied some plays a
      // frame apart -- visible only as an elixir total one frame of
      // regeneration out.
      while (next < plays.size() && plays.get(next).get("step").intValue() == step) {
        JsonNode p = plays.get(next++);
        Side side = p.get("side").intValue() == 1 ? Side.ONE : Side.TWO;
        // Elixir is not topped up. A play the rules refuse must be refused in
        // both engines -- and checked here, at the play, rather than inferred
        // later from an elixir total that is two apart for reasons a minute
        // upstream.
        double before = match.elixir.get(side);
        boolean allowed = match.deploy(
            side, p.get("slot").intValue(), p.get("x").doubleValue(), p.get("y").doubleValue());

        assertThat(allowed)
            .as("play at t=%s: %s slot %d at (%s, %s)", p.get("at"), side,
                p.get("slot").intValue(), p.get("x"), p.get("y"))
            .isEqualTo(p.get("allowed").booleanValue());
        assertThat(before - match.elixir.get(side))
            .as("play at t=%s: elixir spent", p.get("at"))
            .isCloseTo(p.get("spent").doubleValue(), Offset.offset(0.01));
        // The hand right here, rather than at the next checkpoint: the draw,
        // the evolution and the play all happen inside this one call, so this
        // is the only place a difference between them can still be told apart.
        List<String> wanted = new ArrayList<>();
        for (JsonNode n : p.get("handAfter")) wanted.add(n.isNull() ? null : n.stringValue());
        assertThat(match.hand.get(side).stream().map(c -> c == null ? null : c.id()).toList())
            .as("hand after play at t=%s (%s slot %d)", p.get("at"), side, p.get("slot").intValue())
            .isEqualTo(wanted);
      }
      for (MatchEvent e : match.update(1.0 / 30)) {
        if (e instanceof MatchEvent.Hit h) hits.add(h.target().id() + ":" + h.amount());
        else if (e instanceof MatchEvent.Cast c) hits.add(c.unit().id + ":-1");
      }

      if (step % 90 == 0 && checked < checkpoints.size()) {
        compare(checkpoints.get(checked++), match, step, hits);
        hits = new ArrayList<>();
      }
    }

    // Every blow struck in the whole match, in either engine.
    assertThat(struck).as("blows struck over the whole match")
        .containsExactlyInAnyOrderElementsOf(expectedStruck);

    // A match that ended early here but not there is the loudest possible
    // failure, so say so before comparing anything else about the end.
    assertThat(checked)
        .as("checkpoints reached (match ended early?)")
        .isEqualTo(checkpoints.size());
    assertThat(match.over).as("outcome").isEqualTo(over(fixture.get("over")));
    assertHP("final tower hp", fixture.get("finalTowerHP"),
        match.towers.stream().map(t -> (double) t.hp).toList());
  }

  /** TypeScript names the sides for the player; the rules name them by seat. */
  private static String over(JsonNode node) {
    if (node == null || node.isNull()) return null;
    return switch (node.stringValue()) {
      case "player" -> "one";
      case "enemy" -> "two";
      default -> "draw";
    };
  }

  private void compare(JsonNode expected, Match match, int step, List<String> hits) {
    String at = "step " + step + " (t=" + expected.get("time").doubleValue() + ")";

    // Every blow struck since the last checkpoint, before any state is
    // compared: a missing hit explains a health difference, and a health
    // difference explains nothing at all.
    List<String> wantHits = new ArrayList<>();
    for (JsonNode h : expected.get("hits")) {
      wantHits.add(h.get(0).intValue() + ":" + h.get(1).intValue());
    }
    // Collected, not compared here.
    struck.addAll(hits);
    expectedStruck.addAll(wantHits);

    assertThat(match.elixir.get(Side.ONE)).as("%s: elixir one", at)
        .isCloseTo(expected.get("elixir").get(0).doubleValue(), Offset.offset(0.01));
    assertThat(match.elixir.get(Side.TWO)).as("%s: elixir two", at)
        .isCloseTo(expected.get("elixir").get(1).doubleValue(), Offset.offset(0.01));

    // The hand, before anything else that could be a consequence of it.
    for (Side side : Side.values()) {
      JsonNode want = expected.get("hand").get(side == Side.ONE ? 0 : 1);
      List<String> held = match.hand.get(side).stream()
          .map(c -> c == null ? null : c.id()).toList();
      List<String> wanted = new ArrayList<>();
      for (JsonNode n : want) wanted.add(n.isNull() ? null : n.stringValue());
      assertThat(held).as("%s: hand %s", at, side).isEqualTo(wanted);
    }

    assertHP(at + ": tower hp", expected.get("towerHP"),
        match.towers.stream().map(t -> (double) t.hp).toList());

    // `[id, card, hp, x, y]`, in spawn order.
    JsonNode wantUnits = expected.get("units");
    List<Unit> alive = match.units.stream()
        .sorted(java.util.Comparator.comparingInt(u -> u.id)).toList();

    assertThat(alive.stream().map(u -> u.card.id()).toList())
        .as("%s: creatures alive", at)
        .isEqualTo(ids(wantUnits));

    // Creatures with a shot in the air, in either engine.
    java.util.Set<Integer> shotAt = new java.util.HashSet<>();
    for (JsonNode id : expected.get("inFlight")) shotAt.add(id.intValue());
    for (var p : match.projectiles) shotAt.add(p.target.id());

    for (int i = 0; i < alive.size(); i++) {
      Unit u = alive.get(i);
      JsonNode w = wantUnits.get(i);
      String who = at + ": " + u.card.id() + "#" + u.id;
      assertThat(u.id).as("%s id", who).isEqualTo(w.get(0).intValue());

      // Health is exact for everyone not currently being shot at. For those
      // who are, the blow may land either side of this instant -- and that it
      // lands at all is checked over the whole match, which is the claim that
      // actually matters.
      if (!shotAt.contains(u.id)) {
        assertThat((double) u.hp).as("%s hp", who)
            .isCloseTo(w.get(2).doubleValue(), Offset.offset(HP_TOLERANCE));
      }
      assertThat(u.x).as("%s x", who)
          .isCloseTo(w.get(3).doubleValue(), Offset.offset(POSITION_TOLERANCE));
      assertThat(u.y).as("%s y", who)
          .isCloseTo(w.get(4).doubleValue(), Offset.offset(POSITION_TOLERANCE));
    }
  }

  private static List<String> ids(JsonNode units) {
    List<String> out = new ArrayList<>();
    for (JsonNode u : units) out.add(u.get(1).stringValue());
    return out;
  }

  private void assertHP(String what, JsonNode expected, List<Double> actual) {
    List<Double> want = new ArrayList<>();
    for (JsonNode n : expected) want.add(n.doubleValue());

    assertThat(actual.size()).as("%s: count", what).isEqualTo(want.size());
    for (int i = 0; i < want.size(); i++) {
      assertThat(actual.get(i)).as("%s[%d]", what, i)
          .isCloseTo(want.get(i), Offset.offset(HP_TOLERANCE));
    }
  }

  /** The generator itself, before anything that depends on it. */
  @org.junit.jupiter.api.Test
  void mulberryMatches() {
    // The first eight draws of mulberry32(1), taken from the JavaScript.
    RandomGenerator rng = mulberry32(1);
    double[] first = new double[8];
    for (int i = 0; i < first.length; i++) first[i] = rng.nextDouble();

    assertThat(first[0]).isCloseTo(0.6270739405881613, Offset.offset(1e-12));
    for (double d : first) assertThat(d).isBetween(0.0, 1.0);
    // Two runs of the same seed agree; two seeds do not.
    assertThat(mulberry32(1).nextDouble()).isEqualTo(first[0]);
    assertThat(mulberry32(2).nextDouble()).isNotEqualTo(first[0]);
  }
}
