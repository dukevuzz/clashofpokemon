package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.assertj.core.data.Offset;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** Walking, against the answers the running game gave. */
class MovementTest {

  private static Unit unit(String card, double x, double y, int lane) {
    Unit u = new Unit();
    u.card = Cards.byId(card);
    u.id = 1;
    u.side = Side.ONE;
    u.x = x;
    u.y = y;
    u.lane = lane;
    u.speed = u.card.speed();
    u.mass = u.card.mass();
    u.flying = u.card.flying();
    u.jumpsRiver = u.card.jumpsRiver();
    return u;
  }

  @Test
  void banksAndBridgesMatchTheTypeScript() {
    List<String> wrong = new ArrayList<>();
    for (JsonNode row : Fixtures.of("movement")) {
      String fn = row.get("fn").asString();
      double in = row.get("in").get(0).asDouble();
      if (fn.equals("bankOf")) {
        int actual = Board.bankOf(in);
        if (actual != row.get("out").asInt()) {
          wrong.add("bankOf(%s) = %d, expected %s".formatted(in, actual, row.get("out")));
        }
      } else {
        boolean actual = Board.onBridge(in);
        if (actual != row.get("out").asBoolean()) {
          wrong.add("onBridge(%s) = %s, expected %s".formatted(in, actual, row.get("out")));
        }
      }
    }
    assertThat(wrong).isEmpty();
  }

  @Test
  void crossingHeadsTheSameWay() {
    // Twenty positions across both lanes and both directions: the staging in
    // front of a bridge, stepping onto it, and the far bank.
    List<String> wrong = new ArrayList<>();
    for (JsonNode row : Fixtures.of("wayTo")) {
      int lane = row.get("lane").asInt();
      double y = row.get("y").asDouble();
      double ty = row.get("ty").asDouble();
      Unit u = unit("charmander", Rules.config().bridgeX().get(lane), y, lane);

      double[] out = Movement.wayTo(u, Rules.config().bridgeX().get(lane), ty);
      double wantX = row.get("out").get(0).asDouble();
      double wantY = row.get("out").get(1).asDouble();
      if (Math.abs(out[0] - wantX) > 1e-6 || Math.abs(out[1] - wantY) > 1e-6) {
        wrong.add("lane %d y %s -> %s: got [%s, %s], expected [%s, %s]"
            .formatted(lane, y, ty, out[0], out[1], wantX, wantY));
      }
    }
    assertThat(wrong).isEmpty();
  }

  @Test
  void nothingEndsAFrameInTheWater() {
    // The rule that makes the river a river. Crowding can shove a creature off
    // the planks, and a shove is not a decision to swim.
    var c = Rules.config();
    Unit u = unit("charmander", 20, c.riverY(), 0);   // in the water, off-bridge
    Movement.keepOutOfRiver(u, c.riverY() - 60);      // came from the north
    assertThat(Board.bankOf(u.y)).isNotZero();
    assertThat(u.y).isLessThan(c.riverY());           // and went back north
  }

  @Test
  void aCreatureOnABridgeIsLeftAlone() {
    var c = Rules.config();
    Unit u = unit("charmander", c.bridgeX().get(0), c.riverY(), 0);
    double was = u.y;
    Movement.keepOutOfRiver(u, c.riverY() - 60);
    assertThat(u.y).isEqualTo(was);
  }

  @Test
  void paralysisSlowsRatherThanStops() {
    Unit u = unit("charmander", 100, 400, 0);
    double full = Movement.speedOf(u);
    Statuses.apply(u.statuses, StatusKind.PARALYSIS, 3);
    assertThat(Movement.speedOf(u)).isCloseTo(full * Statuses.PARALYSIS_SPEED, Offset.offset(1e-9));
    assertThat(Movement.speedOf(u)).isPositive();
  }

  @Test
  void aCrowdPushesApart() {
    Unit a = unit("charmander", 100, 400, 0);
    Unit b = unit("charmander", 102, 400, 0);
    b.id = 2;
    double[] push = Movement.separation(List.of(a, b), a);
    // a is to the left of b, so it is pushed further left.
    assertThat(push[0]).isNegative();
  }

  @Test
  void twoCreaturesInExactlyTheSamePlaceStillSeparate() {
    // Without the golden-angle nudge a stack of identical units never comes
    // apart: the direction between them is undefined and every push is zero.
    Unit a = unit("charmander", 100, 400, 0);
    Unit b = unit("charmander", 100, 400, 0);
    b.id = 2;
    double[] push = Movement.separation(List.of(a, b), a);
    assertThat(Math.hypot(push[0], push[1])).isPositive();
  }

  @Test
  void flyersIgnoreThoseOnTheGround() {
    Unit ground = unit("charmander", 100, 400, 0);
    Unit flyer = unit("charmander", 100, 400, 0);
    flyer.id = 2;
    flyer.flying = true;
    assertThat(Movement.separation(List.of(ground, flyer), flyer))
        .containsExactly(0.0, 0.0);
  }

  @Test
  void aFasterFriendSqueezesPastASlowerOne() {
    Unit fast = unit("yamper", 100, 400, 0);
    Unit slow = unit("snorlax", 100, 390, 0);
    slow.id = 2;
    // Directly ahead, on the way.
    double nudge = Movement.squeezePast(List.of(fast, slow), fast, 0, -1);
    assertThat(nudge).isNotZero();
  }

  @Test
  void nobodySqueezesPastAnEnemy() {
    // An enemy in the way is fought, not passed.
    Unit fast = unit("yamper", 100, 400, 0);
    Unit enemy = unit("snorlax", 100, 390, 0);
    enemy.id = 2;
    enemy.side = Side.TWO;
    assertThat(Movement.squeezePast(List.of(fast, enemy), fast, 0, -1)).isZero();
  }

  @Test
  void nothingStandsInsideStonework() {
    // A creature deployed on its own tower used to freeze for ever: it stepped
    // into the footprint, was pushed radially out, and repeated.
    Tower t = new Tower();
    t.id = 1;
    t.side = Side.ONE;
    t.kind = "side";
    t.x = 100;
    t.y = 500;
    Unit u = unit("charmander", 100, 500, 0);

    Movement.pushOutOfTowers(List.of(t), u);
    assertThat(Math.abs(u.x - t.x)).isGreaterThanOrEqualTo(Board.radiusOf(t));
  }

  @Test
  void aCreatureIsPushedTheOtherWayRatherThanOffTheBoard() {
    Tower t = new Tower();
    t.id = 1;
    t.side = Side.ONE;
    t.kind = "side";
    t.x = 12;                       // hard against the left edge
    t.y = 500;
    Unit u = unit("charmander", 10, 500, 0);

    Movement.pushOutOfTowers(List.of(t), u);
    assertThat(u.x).isBetween(8.0, (double) Rules.config().arenaWidth() - 8);
  }

  @Test
  void aCreatureHeadsForItsOwnLaneTower() {
    var c = Rules.config();
    Tower mine = tower(1, Side.TWO, "side", c.laneX().get(0), 80);
    Tower other = tower(2, Side.TWO, "side", c.laneX().get(1), 80);
    Tower king = tower(3, Side.TWO, "king", c.arenaWidth() / 2.0, 40);

    // Already across the river, so it goes for a tower rather than a bridge.
    Unit u = unit("charmander", c.laneX().get(0), 100, 0);
    double[] goal = Movement.goalFor(List.of(mine, other, king), u);
    assertThat(goal[0]).isCloseTo(mine.x, Offset.offset(40.0));
  }

  @Test
  void aCreatureThatHasNotCrossedHeadsForABridge() {
    var c = Rules.config();
    Tower king = tower(3, Side.TWO, "king", c.arenaWidth() / 2.0, 40);
    Unit u = unit("charmander", 40, 600, 0);
    double[] goal = Movement.goalFor(List.of(king), u);
    assertThat(goal[0]).isCloseTo(c.bridgeX().get(0), Offset.offset(0.001));
  }

  private static Tower tower(int id, Side side, String kind, double x, double y) {
    Tower t = new Tower();
    t.id = id;
    t.side = side;
    t.kind = kind;
    t.x = x;
    t.y = y;
    t.hp = 100;
    return t;
  }
}
