package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Choosing something to hit, hitting it, and everything that follows. */
class CombatTest {

  private static Match match() {
    Match.Options o = new Match.Options();
    o.rng = DifferentialTest.mulberry32(11);
    return new Match(o);
  }

  private static Unit unit(Match m, String card, Side side, double x, double y) {
    Unit u = Deploy.spawn(m, Cards.byId(card), side, x, y);
    u.spawning = 0;
    return u;
  }

  private static Tower theirTower(Match m) {
    return m.towers.stream()
        .filter(t -> t.side == Side.TWO && "side".equals(t.kind))
        .findFirst().orElseThrow();
  }

  // ------------------------------------------------------------ finding one

  @Test
  void aCreatureSeesTheNearestEnemyInFrontOfIt() {
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    Unit near = unit(m, "caterpie", Side.TWO, 100, 470);
    unit(m, "caterpie", Side.TWO, 100, 420);

    assertThat(Combat.findTarget(m, me, 200)).isSameAs(near);
  }

  @Test
  void whatIsBehindItIsSeenLikeAnythingElse() {
    /*
     * This asserted the opposite until the arc became a full circle.
     *
     * A 220-degree cone left 140 degrees behind a unit invisible, so something
     * deployed behind it was ignored however close it stood -- reported from
     * play, and not how Clash Royale behaves. What is nearest is what you
     * fight, whichever side of you it is on.
     */
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 400);
    Unit behind = unit(m, "caterpie", Side.TWO, 100, 430);

    assertThat(Combat.findTarget(m, me, 60)).isSameAs(behind);
  }

  @Test
  void aTowerIsSeenWhetherOrNotItIsInFront() {
    // A tower is what everything is ultimately for.
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, theirTower(m).x, theirTower(m).y + 20);
    assertThat(Combat.findTarget(m, me, 300)).isInstanceOf(Tower.class);
  }

  @Test
  void somethingStillArrivingIsNotAValidTarget() {
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    Unit arriving = unit(m, "caterpie", Side.TWO, 100, 470);
    arriving.spawning = 1;

    assertThat(Combat.findTarget(m, me, 100)).isNotSameAs(arriving);
  }

  @Test
  void charmSendsACreatureAtWhoeverCharmedIt() {
    // Overrides everything, including the arc and the tower.
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 400);
    Unit charmer = unit(m, "caterpie", Side.TWO, 100, 460);
    Statuses.apply(me.statuses, StatusKind.CHARM, 3, charmer.id);

    assertThat(Combat.findTarget(m, me, 40)).isSameAs(charmer);
  }

  @Test
  void confusionPicksSomethingNearAtRandomOrNothingIfAlone() {
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    Statuses.apply(me.statuses, StatusKind.CONFUSION, 3, null);
    assertThat(Combat.findTarget(m, me, 30)).isNull();

    Unit other = unit(m, "caterpie", Side.TWO, 105, 505);
    assertThat(Combat.findTarget(m, me, 30)).isSameAs(other);
  }

  @Test
  void aCreatureThatOnlyWantsBuildingsIgnoresCreatures() {
    Match m = match();
    Unit me = unit(m, "machop", Side.ONE, 100, 500);
    me.targets = java.util.List.of("building");
    unit(m, "caterpie", Side.TWO, 100, 480);

    Thing found = Combat.findTarget(m, me, 200);
    assertThat(found == null || found instanceof Tower).isTrue();
  }

  // ------------------------------------------------------------ hitting it

  @Test
  void aHitTakesHealthAndIsAnnounced() {
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO, 100, 300);
    int before = target.hp;

    int dealt = Combat.applyHit(m, target, 40, 1, null);
    assertThat(dealt).isPositive();
    assertThat(target.hp).isEqualTo(before - dealt);
    assertThat(m.events).anyMatch(e -> e instanceof MatchEvent.Hit);
  }

  @Test
  void aShieldSoaksFirstAndIsSpentBeforeHealth() {
    // Extra health, not immunity -- and after mitigation, so a buff is never
    // worth more than the armour it sits in front of.
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO, 100, 300);
    target.shield = 1000;
    int before = target.hp;

    Combat.applyHit(m, target, 40, 1, null);
    assertThat(target.hp).isEqualTo(before);
    assertThat(target.shield).isLessThan(1000);
  }

  @Test
  void brokenArmourWeakensOnlyTheDefenceTheAttackIsMeasuredAgainst() {
    Match m = match();
    Unit plain = unit(m, "geodude", Side.TWO, 100, 300);
    Unit broken = unit(m, "geodude", Side.TWO, 120, 300);
    Statuses.apply(broken.statuses, StatusKind.ARMOR_BREAK, 3, null);

    assertThat(Combat.applyHit(m, broken, 60, 1, null, "physical"))
        .isGreaterThan(Combat.applyHit(m, plain, 60, 1, null, "physical"));
  }

  @Test
  void whichDefenceAnAttackIsMeasuredAgainstIsTheAttacksToChoose() {
    Match m = match();
    // A creature whose two defences actually differ -- most do not, and one
    // that does not cannot tell these three paths apart.
    Card lopsided = Cards.all().stream()
        .filter(c -> c.def() != c.speDef()).findFirst().orElseThrow();

    Unit a = Deploy.spawn(m, lopsided, Side.TWO, 100, 300);
    Unit b = Deploy.spawn(m, lopsided, Side.TWO, 120, 300);
    Unit c = Deploy.spawn(m, lopsided, Side.TWO, 140, 300);

    int special = Combat.applyHit(m, a, 60, 1, null, "special");
    int physical = Combat.applyHit(m, b, 60, 1, null, "physical");
    int unresisted = Combat.applyHit(m, c, 60, 1, null, "none");

    assertThat(special).isNotEqualTo(physical);
    // Nothing resists at all, so this is the hardest any of the three can hit.
    assertThat(unresisted).isGreaterThanOrEqualTo(Math.max(special, physical));
  }

  @Test
  void beingHitMakesACreatureLookAtWhoeverHitItWhenItHasNothingToHit() {
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO, 100, 300);
    Unit attacker = unit(m, "machop", Side.ONE, 100, 340);
    target.target = null;

    Combat.applyHit(m, target, 10, 1, attacker);
    assertThat(target.target).isSameAs(attacker);
  }

  @Test
  void beingHitDoesNotPullACreatureOffATower() {
    /*
     * This asserted the opposite until it was reported from play: a Dugtrio
     * mid-swing at a crown tower turned round and chased whatever poked it.
     * A target is kept until it dies or leaves reach -- being hit is neither.
     */
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO, 100, 300);
    Unit attacker = unit(m, "machop", Side.ONE, 100, 340);
    Tower tower = theirTower(m);
    target.target = tower;

    Combat.applyHit(m, target, 10, 1, attacker);
    assertThat(target.target).isSameAs(tower);
  }

  @Test
  void beingShotByATowerDoesNotDistractYou() {
    // Walking past the fight is the whole of what a tower-hunter does.
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO, 100, 300);
    Tower tower = theirTower(m);
    target.target = null;

    Combat.applyHit(m, target, 10, 1, tower);
    assertThat(target.target).isNull();
  }

  @Test
  void healthNeverGoesBelowZeroAndDeathIsAnnouncedOnce() {
    Match m = match();
    Unit target = unit(m, "caterpie", Side.TWO, 100, 300);

    Combat.applyHit(m, target, 100000, 1, null);
    assertThat(target.hp).isZero();
    assertThat(target.dead).isTrue();
    assertThat(m.events.stream().filter(e -> e instanceof MatchEvent.Death)).hasSize(1);
  }

  @Test
  void breakingALaneTowerWakesTheKingBehindIt() {
    Match m = match();
    Tower king = m.towers.stream()
        .filter(t -> t.side == Side.TWO && "king".equals(t.kind)).findFirst().orElseThrow();
    assertThat(king.active).isFalse();

    Combat.applyHit(m, theirTower(m), 100000, 1, null);
    assertThat(king.active).isTrue();
  }

  @Test
  void hittingAKingWakesItToo() {
    Match m = match();
    Tower king = m.towers.stream()
        .filter(t -> t.side == Side.TWO && "king".equals(t.kind)).findFirst().orElseThrow();

    Combat.applyHit(m, king, 10, 1, null);
    assertThat(king.active).isTrue();
  }

  @Test
  void typeAdvantageAppliesBetweenCreaturesAndNotToTowers() {
    Match m = match();
    Unit fire = unit(m, "charmander", Side.ONE, 100, 500);
    Unit grass = unit(m, "bulbasaur", Side.TWO, 100, 300);

    assertThat(Combat.matchup(fire, grass)).isGreaterThan(1);
    // A tower has no typing, so nothing is strong or weak against it.
    assertThat(Combat.matchup(fire, theirTower(m))).isEqualTo(1);
    assertThat(Combat.matchup(theirTower(m), fire)).isEqualTo(1);
  }

  // ---------------------------------------------------------------- casting

  @Test
  void aCastSplashesEverythingRoundTheTarget() {
    Match m = match();
    Unit caster = unit(m, "charmander", Side.ONE, 100, 500);
    Unit target = unit(m, "machop", Side.TWO, 100, 470);
    Unit beside = unit(m, "machop", Side.TWO, 105, 470);
    int t0 = target.hp;
    int b0 = beside.hp;

    Combat.castSkill(m, caster, target, 1);
    assertThat(target.hp).isLessThan(t0);
    // Splash is half, so the neighbour is hurt but less so.
    assertThat(beside.hp).isLessThan(b0).isGreaterThan(target.hp - 1);
  }

  @Test
  void aCastThatIsNotAnAttackDoesItsOwnThingInstead() {
    // These used to resolve as "hit the target, splash the crowd for half",
    // which turned every one of them into a worse basic attack.
    Match m = match();
    Card healer = Cards.all().stream()
        .filter(c -> "WISH".equals(c.skill())).findFirst().orElse(null);
    org.junit.jupiter.api.Assumptions.assumeTrue(healer != null, "no healer in the roster");

    Unit caster = Deploy.spawn(m, healer, Side.ONE, 100, 500);
    caster.spawning = 0;
    Unit hurt = unit(m, "machop", Side.ONE, 105, 500);
    hurt.hp = 1;
    Unit enemy = unit(m, "machop", Side.TWO, 100, 480);
    int enemyBefore = enemy.hp;

    Combat.castSkill(m, caster, enemy, 1);
    assertThat(hurt.hp).isGreaterThan(1);
    assertThat(enemy.hp).isEqualTo(enemyBefore);
  }

  // ------------------------------------------------------------ projectiles

  @Test
  void aShotFliesToItsTargetAndThenLands() {
    Match m = match();
    Unit shooter = unit(m, "squirtle", Side.ONE, 100, 500);
    Unit target = unit(m, "machop", Side.TWO, 100, 400);
    int before = target.hp;

    Combat.launch(m, shooter, target, 30, 1, 200);
    assertThat(m.projectiles).hasSize(1);

    Combat.updateProjectiles(m, 1.0 / 30);
    assertThat(m.projectiles).as("still in flight").hasSize(1);
    assertThat(target.hp).isEqualTo(before);

    for (int i = 0; i < 60 && !m.projectiles.isEmpty(); i++) {
      Combat.updateProjectiles(m, 1.0 / 30);
    }
    assertThat(m.projectiles).isEmpty();
    assertThat(target.hp).isLessThan(before);
  }

  @Test
  void aShotAtSomethingThatDiesHitsNothing() {
    // A projectile that chased a corpse would let a dead unit soak damage
    // aimed past it.
    Match m = match();
    Unit shooter = unit(m, "squirtle", Side.ONE, 100, 500);
    Unit target = unit(m, "machop", Side.TWO, 100, 400);
    Unit behind = unit(m, "machop", Side.TWO, 100, 395);
    int behindBefore = behind.hp;

    Combat.launch(m, shooter, target, 30, 1, 200);
    target.dead = true;
    for (int i = 0; i < 60 && !m.projectiles.isEmpty(); i++) {
      Combat.updateProjectiles(m, 1.0 / 30);
    }
    assertThat(m.projectiles).isEmpty();
    assertThat(behind.hp).isEqualTo(behindBefore);
  }

  @Test
  void aMoveWithNoStatusAfflictsNothing() {
    Match m = match();
    Unit target = unit(m, "machop", Side.TWO, 100, 300);
    Combat.afflict(m, target, null, null);
    Combat.afflict(m, target, "NOT_A_MOVE", null);
    assertThat(target.statuses).isEmpty();
  }
}
