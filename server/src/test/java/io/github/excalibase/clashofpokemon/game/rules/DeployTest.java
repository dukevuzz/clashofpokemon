package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Where a card may be put down, and where a near miss lands instead. */
class DeployTest {

  /** A known deck, dealt in order. */
  private static Match match() {
    Match.Options o = new Match.Options();
    o.rng = DifferentialTest.mulberry32(5);
    o.deckOne = deck();
    o.deckTwo = deck();
    o.shuffle = false;
    Match m = new Match(o);
    m.elixir.put(Side.ONE, 10.0);
    m.elixir.put(Side.TWO, 10.0);
    return m;
  }

  private static java.util.List<Card> deck() {
    return java.util.stream.Stream
        .of("machop", "charmander", "squirtle", "geodude",
            "pidgey", "litwick", "spheal", "diglett")
        .map(Cards::byId).toList();
  }

  private static final double W = Rules.config().arenaWidth();
  private static final double H = Rules.config().arenaHeight();

  @Test
  void yourOwnHalfIsAlwaysOpen() {
    Match m = match();
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W / 2, H - 100)).isTrue();
    assertThat(Deploy.canDeploy(m, Side.TWO, 0, W / 2, 100)).isTrue();
  }

  @Test
  void theirHalfIsNot() {
    Match m = match();
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W / 2, 100)).isFalse();
    assertThat(Deploy.canDeploy(m, Side.TWO, 0, W / 2, H - 100)).isFalse();
  }

  @Test
  void breakingALaneTowerOpensThatLaneAndOnlyThatLane() {
    // The line moving up the board is the visible reward for taking a tower.
    Match m = match();
    Tower left = m.towers.stream()
        .filter(t -> t.side == Side.TWO && "side".equals(t.kind) && t.x < W / 2)
        .findFirst().orElseThrow();
    left.dead = true;
    left.hp = 0;

    // As deep as the tower you broke and no deeper: their doorstep, not their
    // throne room. Opening the whole column made a first tower a win button.
    double justBehind = left.y + Rules.towerBox("side", "up");
    assertThat(Deploy.laneOpen(m, Side.ONE, left.x, justBehind)).isTrue();
    assertThat(Deploy.laneOpen(m, Side.ONE, left.x, justBehind - 20)).isFalse();
    // The other lane is untouched.
    assertThat(Deploy.laneOpen(m, Side.ONE, W - left.x, justBehind)).isFalse();
    // And it is a real gain: that spot was refused a moment ago.
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, left.x, justBehind)).isTrue();
  }

  @Test
  void aTunnellerOrAThrowGoesAnywhere() {
    assertThat(Deploy.arrivesAnywhere("tunnel")).isTrue();
    assertThat(Deploy.arrivesAnywhere("throw")).isTrue();
    assertThat(Deploy.arrivesAnywhere("walk")).isFalse();
    assertThat(Deploy.arrivesAnywhere(null)).isFalse();

    Match m = match();
    m.hand.get(Side.ONE).set(0, Cards.byId("diglett"));
    assertThat(Cards.byId("diglett").delivery()).isEqualTo("tunnel");
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W / 2, 60)).isTrue();
  }

  @Test
  void nothingLandsOffTheBoard() {
    // The vertical bound is not symmetry for its own sake: a drop below the
    // arena passed the own-half test, spent the elixir and spawned a unit past
    // the despawn line, which the next update deleted. The card vanished.
    Match m = match();
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, -5, H - 100)).isFalse();
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W + 5, H - 100)).isFalse();
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W / 2, H + 20)).isFalse();
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W / 2, -20)).isFalse();
  }

  @Test
  void aCardYouCannotAffordIsRefused() {
    Match m = match();
    m.elixir.put(Side.ONE, 0.0);
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, W / 2, H - 100)).isFalse();
  }

  @Test
  void aSlotThatIsNotThereIsRefused() {
    Match m = match();
    assertThat(Deploy.canDeploy(m, Side.ONE, -1, W / 2, H - 100)).isFalse();
    assertThat(Deploy.canDeploy(m, Side.ONE, 99, W / 2, H - 100)).isFalse();
  }

  @Test
  void aNudgeStaysOnYourOwnHalf() {
    Match m = match();
    double[] at = Deploy.nearestDeploy(m, Side.ONE, W / 2, 40, W / 2, false, false);
    assertThat(at[1]).isGreaterThan(H / 2);
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, at[0], at[1])).isTrue();
  }

  @Test
  void aNudgeStaysOnTheBoard() {
    Match m = match();
    for (double x : new double[] {-50, 0, W / 2, W, W + 50}) {
      for (double y : new double[] {-50, 0, H / 2, H, H + 50}) {
        double[] at = Deploy.nearestDeploy(m, Side.ONE, x, y, x, true, false);
        assertThat(at[0]).as("x from %s", x).isBetween(6.0, W - 6);
        assertThat(at[1]).as("y from %s", y).isBetween(6.0, H - 6);
      }
    }
  }

  @Test
  void aDropOnATowerIsPushedClearOfIt() {
    Match m = match();
    Tower mine = m.towers.stream()
        .filter(t -> t.side == Side.ONE && "side".equals(t.kind)).findFirst().orElseThrow();

    double[] at = Deploy.nearestDeploy(m, Side.ONE, mine.x + 4, mine.y + 4, mine.x, false, false);
    double clear = Rules.towerSize(mine.kind) * 0.5;
    assertThat(Math.hypot(at[0] - mine.x, at[1] - mine.y)).isGreaterThan(clear * 0.5);
  }

  @Test
  void aDropDeadCentreOnATowerGoesTheWayTheFingerCameFrom() {
    Match m = match();
    Tower mine = m.towers.stream()
        .filter(t -> t.side == Side.ONE && "side".equals(t.kind)).findFirst().orElseThrow();

    double[] left = Deploy.nearestDeploy(m, Side.ONE, mine.x, mine.y, mine.x - 60, false, false);
    double[] right = Deploy.nearestDeploy(m, Side.ONE, mine.x, mine.y, mine.x + 60, false, false);
    assertThat(left[0]).isLessThan(mine.x);
    assertThat(right[0]).isGreaterThan(mine.x);
  }

  @Test
  void aThrowTakesLongerTheFurtherItIsLobbed() {
    Card thrown = Cards.all().stream()
        .filter(c -> "throw".equals(c.delivery())).findFirst().orElse(null);
    org.junit.jupiter.api.Assumptions.assumeTrue(thrown != null, "no thrown card in the roster");

    double near = Deploy.arrivalTime(thrown, Side.ONE, H - 40);
    double far = Deploy.arrivalTime(thrown, Side.ONE, 40);
    assertThat(far).isGreaterThan(near);
    assertThat(near).isGreaterThanOrEqualTo(Rules.config().throwMinTime());
  }

  @Test
  void everythingElseArrivesInItsOwnFlatTime() {
    Card walker = Cards.byId("machop");
    assertThat(Deploy.arrivalTime(walker, Side.ONE, 100))
        .isEqualTo(Deploy.arrivalTime(walker, Side.ONE, 600))
        .isEqualTo(walker.deployDelay());
  }

  @Test
  void aPlayCostsElixirDrawsACardAndPutsSomethingOnTheBoard() {
    Match m = match();
    Card played = m.hand.get(Side.ONE).getFirst();
    double before = m.elixir.get(Side.ONE);

    assertThat(m.deploy(Side.ONE, 0, W / 2, H - 100)).isTrue();
    assertThat(m.elixir.get(Side.ONE)).isEqualTo(before - played.elixir());
    assertThat(m.units).hasSize(played.count());
    assertThat(m.hand.get(Side.ONE).getFirst()).isNotEqualTo(played);
  }

  @Test
  void aCardThatPutsDownSeveralBodiesSpreadsThem() {
    Match m = match();
    Card swarm = Cards.all().stream().filter(c -> c.count() > 1).findFirst().orElse(null);
    org.junit.jupiter.api.Assumptions.assumeTrue(swarm != null, "no multi-body card");

    m.hand.get(Side.ONE).set(0, swarm);
    m.deploy(Side.ONE, 0, W / 2, H - 100);
    assertThat(m.units).hasSize(swarm.count());
    assertThat(m.units.stream().map(u -> u.x).distinct()).hasSize(swarm.count());
  }

  @Test
  void aRefusedPlayCostsNothingAndChangesNothing() {
    Match m = match();
    Card held = m.hand.get(Side.ONE).getFirst();
    double before = m.elixir.get(Side.ONE);

    assertThat(m.deploy(Side.ONE, 0, W / 2, 60)).isFalse();
    assertThat(m.elixir.get(Side.ONE)).isEqualTo(before);
    assertThat(m.hand.get(Side.ONE).getFirst()).isEqualTo(held);
    assertThat(m.units).isEmpty();
  }

  @Test
  void aSpawnedCreatureCarriesTheCardsStats() {
    Match m = match();
    Card card = Cards.byId("machop");
    Unit u = Deploy.spawn(m, card, Side.ONE, 100, 500);

    assertThat(u.hp).isEqualTo(card.hp());
    assertThat(u.maxHP).isEqualTo(card.hp());
    assertThat(u.damage).isEqualTo(card.damage());
    assertThat(u.range).isEqualTo(card.range());
    assertThat(u.side).isEqualTo(Side.ONE);
    // Side one walks up the board, so it starts facing that way.
    assertThat(u.facing).isEqualTo(4);
    assertThat(u.spawning).isEqualTo(u.arriveTime).isPositive();
  }

  @Test
  void aDropTooDeepLandsAtTheLineYouEarned() {
    /*
     * What a broken tower is actually worth, at the moment of dropping.
     *
     * The nudge used to ask whether the exact point was legal and, if not,
     * snap all the way back to the halfway line. So after taking a tower, a
     * drop twenty pixels too far forward jumped a hundred and seventy pixels
     * backwards -- and the reward for the tower looked like it had never been
     * granted. Reported by somebody playing, which is the only way this kind
     * of thing gets found: every rule involved was behaving correctly.
     */
    Match m = match();
    Tower theirs = m.towers.stream()
        .filter(t -> t.side == Side.TWO && "side".equals(t.kind) && t.x < W / 2)
        .findFirst().orElseThrow();

    double home = Deploy.nearestDeploy(m, Side.ONE, theirs.x, 100, theirs.x, false, false)[1];
    assertThat(home).as("before: snapped back to my own half").isGreaterThan(H / 2);

    theirs.dead = true;
    theirs.hp = 0;

    double line = Deploy.frontLine(m, Side.ONE, theirs.x);
    double landed = Deploy.nearestDeploy(m, Side.ONE, theirs.x, 100, theirs.x, false, false)[1];

    assertThat(landed).as("after: at the front of what was won").isEqualTo(line);
    assertThat(landed).isLessThan(home);
    // And the place it chose is somewhere a card may actually go.
    assertThat(Deploy.canDeploy(m, Side.ONE, 0, theirs.x, landed)).isTrue();
  }

  @Test
  void everyNudgeLandsSomewhereLegal() {
    // The nudge is a courtesy, and a courtesy that puts a card somewhere the
    // rules refuse is worse than refusing the drop.
    Match m = match();
    m.towers.stream()
        .filter(t -> t.side == Side.TWO && "side".equals(t.kind) && t.x < W / 2)
        .forEach(t -> { t.dead = true; t.hp = 0; });

    for (double x = 10; x < W - 10; x += 11) {
      for (double y = 10; y < H - 10; y += 11) {
        double[] at = Deploy.nearestDeploy(m, Side.ONE, x, y, x, false, false);
        assertThat(Deploy.canDeploy(m, Side.ONE, 0, at[0], at[1]))
            .as("drop (%s, %s) landed at (%s, %s)", x, y, at[0], at[1])
            .isTrue();
      }
    }
  }
}
