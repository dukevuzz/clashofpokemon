package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

/** A whole match, played. */
class MatchTest {

  /** A deterministic generator, so a surprising run can be reproduced. */
  private static RandomGenerator mulberry(long seed) {
    return new RandomGenerator() {
      private int state = (int) seed;

      @Override
      public long nextLong() {
        return (long) (nextDouble() * Long.MAX_VALUE);
      }

      @Override
      public double nextDouble() {
        state = state + 0x6d2b79f5;
        int t = state;
        t = (t ^ (t >>> 15)) * (1 | t);
        t = t + ((t ^ (t >>> 7)) * (61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0 & 0xffffffffL) / 4294967296.0;
      }
    };
  }

  private static Match match(long seed) {
    Match.Options opts = new Match.Options();
    opts.rng = mulberry(seed);
    return new Match(opts);
  }

  /** Play to the end, or give up: a match that never finishes is the bug. */
  private static Match play(long seed) {
    Match m = match(seed);
    int steps = 0;
    while (m.over == null && steps++ < 20_000) {
      m.update(1.0 / 30);
    }
    return m;
  }

  @Test
  void aMatchSetsUpSixTowers() {
    Match m = match(1);
    assertThat(m.towers).hasSize(6);
    assertThat(m.towers.stream().filter(t -> "king".equals(t.kind)).count()).isEqualTo(2);
    // A king sleeps until something wakes it.
    assertThat(m.towers.stream().filter(t -> "king".equals(t.kind)))
        .allSatisfy(t -> assertThat(t.active).isFalse());
  }

  @Test
  void bothSidesGetAHandAndADeck() {
    Match m = match(2);
    for (Side side : Side.values()) {
      assertThat(m.deck.get(side)).hasSize(Rules.config().deckSize());
      assertThat(m.hand.get(side)).hasSize(Rules.config().handSize());
      assertThat(m.hand.get(side)).doesNotContainNull();
    }
  }

  @Test
  void theSameSeedPlaysTheSameMatch() {
    // What a replay and an authoritative server both rest on.
    Match a = play(77);
    Match b = play(77);
    assertThat(a.over).isEqualTo(b.over);
    assertThat(a.towers.stream().map(t -> t.hp).toList())
        .isEqualTo(b.towers.stream().map(t -> t.hp).toList());
  }

  @Test
  void everyMatchFinishes() {
    for (long seed : List.of(1L, 2L, 3L, 4L, 5L)) {
      assertThat(play(seed).over).as("seed %d", seed).isNotNull();
    }
  }

  @Test
  void nothingImpossibleHappens() {
    for (long seed : List.of(1L, 2L, 3L)) {
      Match m = match(seed);
      for (int i = 0; i < 3000 && m.over == null; i++) {
        m.update(1.0 / 30);
        for (Side side : Side.values()) {
          assertThat(m.elixir.get(side)).isBetween(-0.001, Rules.config().elixirMax() + 0.001);
        }
        for (Unit u : m.units) {
          assertThat(Double.isFinite(u.x) && Double.isFinite(u.y)).isTrue();
          assertThat(u.hp).isGreaterThanOrEqualTo(0);
          assertThat(u.x).isBetween(0.0, (double) Rules.config().arenaWidth());
        }
      }
    }
  }

  @Test
  void elixirFillsAndIsSpent() {
    Match m = match(9);
    double start = m.elixir.get(Side.ONE);
    for (int i = 0; i < 90; i++) m.update(1.0 / 30);
    assertThat(m.elixir.get(Side.ONE)).isGreaterThan(start);

    m.elixir.put(Side.ONE, 10.0);
    double before = m.elixir.get(Side.ONE);

    // Not slot zero. A copying card -- Ditto -- costs Infinity until something
    // has been played, because what it costs is one more than the thing it
    // copies. That is the rule working, but it makes "can this be the opening
    // move" depend on which card the shuffle dealt into slot zero, and this
    // test is about elixir being spent, not about the deal.
    int slot = -1;
    for (int i = 0; i < m.hand.get(Side.ONE).size(); i++) {
      if (Double.isFinite(Hand.costOf(m, Side.ONE, m.hand.get(Side.ONE).get(i)))) {
        slot = i;
        break;
      }
    }
    assertThat(slot).as("a hand with nothing playable in it").isNotNegative();

    assertThat(m.deploy(Side.ONE, slot, 144, 560)).isTrue();
    assertThat(m.elixir.get(Side.ONE)).isLessThan(before);
    assertThat(m.units).isNotEmpty();
  }

  @Test
  void aDeployedCreatureArrivesBeforeItActs() {
    // Visible, targetable and inert: the opponent gets to see it land and
    // answer, which is what stops a drop being a free hit.
    Match m = match(11);
    m.elixir.put(Side.ONE, 10.0);
    m.deploy(Side.ONE, 0, 144, 560);
    Unit u = m.units.getFirst();
    assertThat(u.spawning).isPositive();
    assertThat(u.arriveTime).isEqualTo(u.spawning);
  }

  @Test
  void aMatchThatRunsOutOfTimeIsDecidedOnTowers() {
    Match m = match(13);
    m.time = 0.01;
    m.update(1.0 / 30);
    assertThat(m.over).isIn("one", "two", "draw");
  }

  @Test
  void aFallenKingEndsIt() {
    Match m = match(15);
    for (Tower t : m.towers) {
      if (t.side == Side.TWO && "king".equals(t.kind)) { t.dead = true; t.hp = 0; }
    }
    m.update(1.0 / 30);
    assertThat(m.over).isEqualTo("one");
  }

  @Test
  void eventsAreDrainedRatherThanCleared() {
    // `deploy` pushes events too, and a caller that deploys between frames --
    // which every caller does -- had those silently discarded when the list
    // was cleared at the start of the step instead of drained at the end.
    Match m = match(17);
    m.elixir.put(Side.ONE, 10.0);
    m.deploy(Side.ONE, 0, 144, 560);
    List<MatchEvent> events = m.update(1.0 / 30);
    assertThat(events).anyMatch(e -> e instanceof MatchEvent.Spawn);
  }

  @Test
  void towersShootWhatComesNear() {
    Match m = match(19);
    Tower theirs = m.towers.stream()
        .filter(t -> t.side == Side.TWO && "side".equals(t.kind)).findFirst().orElseThrow();

    Unit u = Deploy.spawn(m, Cards.byId("charmander"), Side.ONE, theirs.x, theirs.y + 40);
    u.spawning = 0;
    for (int i = 0; i < 120 && !u.dead; i++) m.update(1.0 / 30);
    // Either it was shot, or it is hitting the tower -- both mean the tower
    // and the creature found each other.
    assertThat(u.hp < u.maxHP || theirs.hp < theirs.maxHP).isTrue();
  }
}
