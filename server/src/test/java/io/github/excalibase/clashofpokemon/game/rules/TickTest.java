package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** One frame, for one creature or one tower. */
class TickTest {

  private static final double FRAME = 1.0 / 30;

  private static Match match() {
    Match.Options o = new Match.Options();
    o.rng = DifferentialTest.mulberry32(13);
    return new Match(o);
  }

  private static Unit unit(Match m, String card, Side side, double x, double y) {
    Unit u = Deploy.spawn(m, Cards.byId(card), side, x, y);
    u.spawning = 0;
    return u;
  }

  private static Tower tower(Match m, Side side, String kind) {
    return m.towers.stream()
        .filter(t -> t.side == side && kind.equals(t.kind)).findFirst().orElseThrow();
  }

  // --------------------------------------------------------------- arriving

  @Test
  void anArrivingCreatureDoesNothingUntilItHasLanded() {
    Match m = match();
    Unit u = Deploy.spawn(m, Cards.byId("machop"), Side.ONE, 100, 500);
    double x = u.x;
    double y = u.y;

    Tick.updateUnit(m, u, FRAME);
    assertThat(u.x).isEqualTo(x);
    assertThat(u.y).isEqualTo(y);
    assertThat(u.spawning).isPositive();
  }

  @Test
  void landingIsAnnouncedOnce() {
    Match m = match();
    Unit u = Deploy.spawn(m, Cards.byId("machop"), Side.ONE, 100, 500);
    for (int i = 0; i < 200; i++) Tick.updateUnit(m, u, FRAME);

    assertThat(m.events.stream().filter(e -> e instanceof MatchEvent.Ready)).hasSize(1);
  }

  @Test
  void aDropLandsOnWhateverIsUnderIt() {
    // Applied at the landing, not at the deploy: the opponent gets the whole
    // delay to walk out of the shadow, which is what stops it being free.
    Match m = match();
    Card dropped = Cards.all().stream()
        .filter(c -> "drop".equals(c.delivery())).findFirst().orElse(null);
    org.junit.jupiter.api.Assumptions.assumeTrue(dropped != null, "no dropped card");

    Unit under = unit(m, "machop", Side.TWO, 100, 500);
    int before = under.hp;
    Unit falling = Deploy.spawn(m, dropped, Side.ONE, 100, 500);

    for (int i = 0; i < 200 && falling.spawning > 0; i++) Tick.updateUnit(m, falling, FRAME);
    assertThat(under.hp).isLessThan(before);
  }

  // --------------------------------------------------------------- statuses

  @Test
  void burnAndPoisonBiteInProportionToHealth() {
    // A flat tick is a scratch on a 600hp tank and lethal to a Caterpie.
    Match m = match();
    Unit big = unit(m, "geodude", Side.TWO, 100, 300);
    Unit small = unit(m, "caterpie", Side.TWO, 120, 300);
    Statuses.apply(big.statuses, StatusKind.BURN, 10, null);
    Statuses.apply(small.statuses, StatusKind.BURN, 10, null);

    for (int i = 0; i < 90; i++) {
      Tick.updateUnit(m, big, FRAME);
      Tick.updateUnit(m, small, FRAME);
    }
    assertThat(big.maxHP - big.hp).isGreaterThan(small.maxHP - small.hp);
  }

  @Test
  void burnCanKillAndTheDeathIsAnnounced() {
    Match m = match();
    Unit u = unit(m, "caterpie", Side.TWO, 100, 300);
    u.hp = 1;
    Statuses.apply(u.statuses, StatusKind.BURN, 10, null);

    for (int i = 0; i < 90 && !u.dead; i++) Tick.updateUnit(m, u, FRAME);
    assertThat(u.dead).isTrue();
    assertThat(u.hp).isZero();
    assertThat(m.events).anyMatch(e -> e instanceof MatchEvent.Death);
  }

  @Test
  void afrozenCreatureStandsStill() {
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE, 100, 500);
    Statuses.apply(u.statuses, StatusKind.FREEZE, 5, null);
    double y = u.y;

    for (int i = 0; i < 30; i++) Tick.updateUnit(m, u, FRAME);
    assertThat(u.y).isEqualTo(y);
    assertThat(u.action).isEqualTo("Idle");
  }

  @Test
  void flinchingStopsTheSwingButNotTheStare() {
    // In range, facing the right way, and unable to hit: the cheapest status
    // to reason about and the harshest at close range.
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    Unit them = unit(m, "machop", Side.TWO, 100, 490);
    Statuses.apply(me.statuses, StatusKind.FLINCH, 5, null);
    int before = them.hp;

    for (int i = 0; i < 60; i++) Tick.updateUnit(m, me, FRAME);
    assertThat(them.hp).isEqualTo(before);
    assertThat(me.action).isIn("Attack", "Shoot");
  }

  // ---------------------------------------------------------- walking, fighting

  @Test
  void aCreatureWithNothingNearWalksUpTheBoard() {
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE, 100, 600);
    double y = u.y;

    for (int i = 0; i < 30; i++) Tick.updateUnit(m, u, FRAME);
    assertThat(u.y).isLessThan(y);
    assertThat(u.action).isEqualTo("Walk");
  }

  @Test
  void aCreatureStopsAndHitsWhatItCatches() {
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    Unit them = unit(m, "machop", Side.TWO, 100, 488);
    int before = them.hp;

    for (int i = 0; i < 90; i++) Tick.updateUnit(m, me, FRAME);
    assertThat(them.hp).isLessThan(before);
  }

  @Test
  void aTargetThatDiesIsLetGoOf() {
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    Unit them = unit(m, "machop", Side.TWO, 100, 488);
    Tick.updateUnit(m, me, FRAME);
    assertThat(me.target).isSameAs(them);

    them.dead = true;
    Tick.updateUnit(m, me, FRAME);
    assertThat(me.target).isNotSameAs(them);
  }

  @Test
  void nothingWalksOffTheSideOfTheBoard() {
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE, 9, 600);
    for (int i = 0; i < 300; i++) Tick.updateUnit(m, u, FRAME);
    assertThat(u.x).isBetween(8.0, (double) Rules.config().arenaWidth() - 8);
  }

  // ----------------------------------------------------------------- towers

  @Test
  void aSleepingKingDoesNothing() {
    Match m = match();
    Tower king = tower(m, Side.TWO, "king");
    unit(m, "machop", Side.ONE, king.x, king.y + 20);

    for (int i = 0; i < 60; i++) Tick.updateTower(m, king, FRAME);
    assertThat(m.projectiles).isEmpty();
  }

  @Test
  void aWokenKingTakesAMomentBeforeItFires() {
    Match m = match();
    Tower king = tower(m, Side.TWO, "king");
    unit(m, "machop", Side.ONE, king.x, king.y + 20);

    Tick.wakeKing(m, king);
    assertThat(king.waking).isPositive();
    Tick.updateTower(m, king, FRAME);
    assertThat(m.projectiles).isEmpty();

    for (int i = 0; i < 300 && m.projectiles.isEmpty(); i++) Tick.updateTower(m, king, FRAME);
    assertThat(m.projectiles).isNotEmpty();
  }

  @Test
  void wakingAKingTwiceIsHarmless() {
    Match m = match();
    Tower king = tower(m, Side.TWO, "king");
    Tick.wakeKing(m, king);
    double waking = king.waking;
    Tick.wakeKing(m, king);

    assertThat(king.waking).isEqualTo(waking);
    assertThat(m.events.stream().filter(e -> e instanceof MatchEvent.KingWakes)).hasSize(1);
  }

  @Test
  void aDeadKingStaysDead() {
    Match m = match();
    Tower king = tower(m, Side.TWO, "king");
    king.dead = true;
    Tick.wakeKing(m, king);
    assertThat(king.active).isFalse();
  }

  @Test
  void aTowerShootsWhatComesIntoRangeAndThenReloads() {
    Match m = match();
    Tower t = tower(m, Side.TWO, "side");
    unit(m, "machop", Side.ONE, t.x, t.y + 20);

    Tick.updateTower(m, t, FRAME);
    assertThat(m.projectiles).hasSize(1);
    // Not again on the very next frame: that cadence is the tower's whole
    // damage output, and firing every frame would be 30 times too much.
    Tick.updateTower(m, t, FRAME);
    assertThat(m.projectiles).hasSize(1);
  }

  @Test
  void aTowerWithNothingInRangeHoldsItsFire() {
    Match m = match();
    Tower t = tower(m, Side.TWO, "side");
    unit(m, "machop", Side.ONE, t.x, t.y + 400);

    for (int i = 0; i < 30; i++) Tick.updateTower(m, t, FRAME);
    assertThat(m.projectiles).isEmpty();
  }
}
