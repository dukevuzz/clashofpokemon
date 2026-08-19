package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The thirteen casts that are not simply damage. */
class SkillsTest {

  private static Match match() {
    Match.Options o = new Match.Options();
    o.rng = DifferentialTest.mulberry32(3);
    Match m = new Match(o);
    m.elixir.put(Side.ONE, 5.0);
    return m;
  }

  private static Unit unit(Match m, String card, Side side, double x, double y) {
    Unit u = Deploy.spawn(m, Cards.byId(card), side, x, y);
    u.spawning = 0;
    return u;
  }

  // ------------------------------------------------------------ the effects

  @Test
  void happyHourMakesElixir() {
    Match m = match();
    Unit u = unit(m, "charmander", Side.ONE, 100, 500);
    double before = m.elixir.get(Side.ONE);

    assertThat(Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("HAPPY_HOUR")))
        .isTrue();
    assertThat(m.elixir.get(Side.ONE)).isGreaterThan(before);
  }

  @Test
  void elixirNeverOverfills() {
    Match m = match();
    Unit u = unit(m, "charmander", Side.ONE, 100, 500);
    m.elixir.put(Side.ONE, (double) Rules.config().elixirMax());

    Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("HAPPY_HOUR"));
    assertThat(m.elixir.get(Side.ONE)).isEqualTo(Rules.config().elixirMax());
  }

  @Test
  void teleportMovesForwardAndStaysOnTheBoard() {
    Match m = match();
    Unit u = unit(m, "abra", Side.ONE, 100, 500);
    double before = u.y;

    Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("TELEPORT"));
    // Side one moves up the board, so forward is a smaller y.
    assertThat(u.y).isLessThan(before);
    assertThat(u.y).isBetween(8.0, (double) Rules.config().arenaHeight() - 8);
  }

  @Test
  void teleportWillNotLeaveTheBoard() {
    Match m = match();
    Unit u = unit(m, "abra", Side.ONE, 100, 12);
    Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("TELEPORT"));
    assertThat(u.y).isGreaterThanOrEqualTo(8);
  }

  @Test
  void wishHealsEveryoneNearbyAndNoneAboveFull() {
    Match m = match();
    Unit caster = unit(m, "togepi", Side.ONE, 100, 500);
    Unit hurt = unit(m, "machop", Side.ONE, 110, 500);
    Unit whole = unit(m, "geodude", Side.ONE, 120, 500);
    hurt.hp = 1;

    Skills.applyEffect(m, m.towers, caster, List.of(caster, hurt, whole),
        Skills.effectFor("WISH"));
    assertThat(hurt.hp).isGreaterThan(1);
    assertThat(whole.hp).isEqualTo(whole.maxHP);
  }

  @Test
  void aShieldGoesOnTheToughestAllyRatherThanTheCaster() {
    // Worth most on whatever is already soaking the damage.
    Match m = match();
    Unit caster = unit(m, "pikachu", Side.ONE, 100, 500);
    Unit tank = unit(m, "geodude", Side.ONE, 110, 500);
    tank.maxHP = 9999;

    Skills.applyEffect(m, m.towers, caster, List.of(caster, tank),
        Skills.effectFor("ELECTRIFY"));
    assertThat(tank.shield).isPositive();
    assertThat(caster.shield).isZero();
  }

  @Test
  void aShieldWithNobodyElseAroundGoesOnTheCaster() {
    Match m = match();
    Unit caster = unit(m, "pikachu", Side.ONE, 100, 500);
    Skills.applyEffect(m, m.towers, caster, List.of(caster), Skills.effectFor("ELECTRIFY"));
    assertThat(caster.shield).isPositive();
  }

  @Test
  void theThreeBuffsEachTouchTheirOwnStat() {
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE, 100, 500);
    double speed = u.speed;
    int def = u.def;
    int speDef = u.speDef;

    Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("AGILITY"));
    assertThat(u.speed).isGreaterThan(speed);
    assertThat(u.def).isEqualTo(def);

    Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("DEFENSE_CURL"));
    assertThat(u.def).isGreaterThan(def);

    Skills.applyEffect(m, m.towers, u, List.of(u), Skills.effectFor("WONDER_ROOM"));
    assertThat(u.speDef).isGreaterThan(speDef);
  }

  @Test
  void anUnknownSkillDoesNothingRatherThanSomethingWrong() {
    Match m = match();
    Unit u = unit(m, "machop", Side.ONE, 100, 500);
    assertThat(Skills.effectFor("NOT_A_MOVE")).isNull();
    assertThat(Skills.effectFor(null)).isNull();
    assertThat(Skills.applyEffect(m, m.towers, u, List.of(u), null)).isFalse();
  }

  // ----------------------------------------------------------- powered moves

  @Test
  void anOrdinaryMoveIsNotPowered() {
    Match m = match();
    Unit u = unit(m, "charmander", Side.ONE, 100, 500);
    assertThat(Skills.poweredDamage("EMBER", u, null)).isNull();
    assertThat(Skills.poweredDamage(null, u, null)).isNull();
  }

  @Test
  void bodySlamScalesWithTheCastersHealth() {
    Match m = match();
    Unit u = unit(m, "spheal", Side.ONE, 100, 500);
    Double small = Skills.poweredDamage("BODY_SLAM", u, null);
    u.maxHP *= 2;
    Double large = Skills.poweredDamage("BODY_SLAM", u, null);

    assertThat(small).isNotNull();
    assertThat(large).isGreaterThan(small);
  }

  @Test
  void foulPlayScalesWithWhateverItIsHitting() {
    Match m = match();
    Unit u = unit(m, "sneasel", Side.ONE, 100, 500);
    Unit weak = unit(m, "caterpie", Side.TWO, 100, 300);
    Unit strong = unit(m, "machop", Side.TWO, 110, 300);
    strong.damage = weak.damage * 4 + 1;

    assertThat(Skills.poweredDamage("FOUL_PLAY", u, strong))
        .isGreaterThan(Skills.poweredDamage("FOUL_PLAY", u, weak));
    // No target at all: it falls back to the caster rather than to zero.
    assertThat(Skills.poweredDamage("FOUL_PLAY", u, null)).isPositive();
  }

  @Test
  void rolloutMakesTheCasterToughenAsItGoes() {
    // The one powered move with a real side effect, which is why it cannot be
    // resolved ahead of the fight.
    Match m = match();
    Unit u = unit(m, "geodude", Side.ONE, 100, 500);
    int def = u.def;

    Double first = Skills.poweredDamage("ROLLOUT", u, null);
    assertThat(u.def).isGreaterThan(def);
    assertThat(Skills.poweredDamage("ROLLOUT", u, null)).isGreaterThan(first);
  }

  @Test
  void aPoweredMoveReadsTheStageItIsCastAt() {
    Match m = match();
    Unit early = unit(m, "machop", Side.ONE, 100, 500);
    Unit late = unit(m, "machop", Side.ONE, 110, 500);
    late.card = Cards.byId("machamp");

    assertThat(Skills.poweredDamage("METEOR_MASH", late, null))
        .isGreaterThan(Skills.poweredDamage("METEOR_MASH", early, null));
  }
}
