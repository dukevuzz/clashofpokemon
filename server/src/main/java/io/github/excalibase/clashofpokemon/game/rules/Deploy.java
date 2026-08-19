package io.github.excalibase.clashofpokemon.game.rules;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Putting a card on the board. */
public final class Deploy {

  private Deploy() {}

  /** Cards that may be placed anywhere: tunnellers and thrown things. */
  public static boolean arrivesAnywhere(String delivery) {
    return "tunnel".equals(delivery) || "throw".equals(delivery);
  }

  /** Is that lane open to us? */
  public static boolean laneOpen(Match match, Side side, double x, double y) {
    var c = Rules.config();
    int lane = x < c.arenaWidth() / 2.0 ? 0 : 1;
    Tower broken = null;
    for (Tower t : match.towers) {
      if (t.side == side || !"side".equals(t.kind) || !t.dead) continue;
      if ((t.x < c.arenaWidth() / 2.0 ? 0 : 1) == lane) { broken = t; break; }
    }
    if (broken == null) return false;

    int forward = Board.forwardFor(side);
    double limit = broken.y - forward * Rules.towerBox("side", "up");
    return forward < 0 ? y >= limit : y <= limit;
  }

  public static boolean canDeploy(Match match, Side side, int slot, double x, double y) {
    var c = Rules.config();
    List<Card> hand = match.hand.get(side);
    if (slot < 0 || slot >= hand.size()) return false;
    Card card = hand.get(slot);
    if (card == null) return false;
    if (match.elixir.get(side) < Hand.costOf(match, side, card)) return false;

    // Inside the board on every side. The vertical bound is not symmetry for
    // its own sake: without it a drop below the arena passed the own-half
    // test, spent the elixir and spawned a unit past the despawn line, which
    // update() deletes on the same frame. The card vanished.
    if (x < 6 || x > c.arenaWidth() - 6) return false;
    if (y < 6 || y > c.arenaHeight() - 6) return false;

    if (arrivesAnywhere(card.delivery())) return true;

    double half = c.arenaHeight() / 2.0;
    boolean ownHalf = side == Side.ONE
        ? y >= half + c.deployMargin()
        : y <= half - c.deployMargin();
    if (ownHalf) return true;
    return laneOpen(match, side, x, y);
  }

  /** The furthest forward this side may drop at this x: the halfway line, or the
   * near edge of a tower it has broken in that lane. */
  static double frontLine(Match match, Side side, double x) {
    var c = Rules.config();
    int forward = Board.forwardFor(side);
    double half = c.arenaHeight() / 2.0;
    double ownHalf = forward < 0 ? half + c.deployMargin() : half - c.deployMargin();

    int lane = x < c.arenaWidth() / 2.0 ? 0 : 1;
    for (Tower t : match.towers) {
      if (t.side == side || !"side".equals(t.kind) || !t.dead) continue;
      if ((t.x < c.arenaWidth() / 2.0 ? 0 : 1) != lane) continue;
      return t.y - forward * Rules.towerBox("side", "up");
    }
    return ownHalf;
  }

  /** The closest place this side may legally drop, to where the finger let go. */
  public static double[] nearestDeploy(
      Match match, Side side, double x, double y, double approachX,
      boolean anywhere, boolean delivered) {

    var c = Rules.config();
    double half = c.arenaHeight() / 2.0;
    int forward = Board.forwardFor(side);

    x = Math.min(Math.max(x, 7), c.arenaWidth() - 7);
    y = Math.min(Math.max(y, 7), c.arenaHeight() - 7);

    // Forward to the line this side may actually reach, which is not always
    // the halfway line: breaking an enemy lane tower moves it up. Asking
    // whether the exact drop was legal and snapping home otherwise threw a
    // slightly-too-deep drop a hundred and seventy pixels backwards, so the
    // reward for taking a tower looked like it had never been granted.
    if (!anywhere) {
      double line = frontLine(match, side, x);
      y = forward < 0 ? Math.max(y, line) : Math.min(y, line);
    }

    for (Tower t : match.towers) {
      if (t.dead) continue;
      double up = Rules.towerBox(t.kind, "up");
      double down = Rules.towerBox(t.kind, "down");
      double clear = Rules.towerSize(t.kind) * 0.5 + c.unitSize() * 0.6;
      double m = c.unitSize() * 0.6;
      double dy = y - t.y;
      if (Math.abs(x - t.x) >= clear) continue;
      if (dy <= -up - m || dy >= down + m) continue;

      boolean centred = Math.abs(x - t.x) < 2 && Math.abs(y - t.y) < 2;
      if (!centred) {
        double lo;
        double hi;
        if (anywhere || laneOpen(match, side, x, y)) {
          lo = 7;
          hi = c.arenaHeight() - 7;
        } else if (forward < 0) {
          lo = half + c.deployMargin();
          hi = c.arenaHeight() - 7;
        } else {
          lo = 7;
          hi = half - c.deployMargin();
        }

        // Four ways out, nearest first, and the first that lands somewhere
        // legal wins. Sorting rather than picking a side keeps the nudge as
        // small as the geometry allows.
        List<double[]> outs = new ArrayList<>(List.of(
            new double[] {x - (t.x - clear), t.x - clear, y},
            new double[] {t.x + clear - x, t.x + clear, y},
            new double[] {y - (t.y - up - m), x, t.y - up - m},
            new double[] {t.y + down + m - y, x, t.y + down + m}));
        outs.sort(Comparator.comparingDouble(o -> o[0]));

        for (double[] out : outs) {
          if (out[1] >= 7 && out[1] <= c.arenaWidth() - 7 && out[2] >= lo && out[2] <= hi) {
            x = out[1];
            y = out[2];
            break;
          }
        }
        continue;
      }

      // Dropped dead centre on a tower: the release point decides which side
      // it is pushed to, not where the drag began.
      double from = delivered ? x : approachX;
      double push = from <= t.x ? -1 : 1;
      double want = t.x + push * clear;
      x = (want < 7 || want > c.arenaWidth() - 7) ? t.x - push * clear : want;
    }
    return new double[] {x, y};
  }

  /**
   * Where a side's king stands.
   *
   * From the config rather than the match, so arrival timing stays a pure
   * function of the card and the board.
   */
  public static double[] kingSpot(Side side) {
    var c = Rules.config();
    return new double[] {
      c.arenaWidth() / 2.0,
      side == Side.ONE
        ? c.arenaHeight() - Rules.towerBackOff("king")
        : Rules.towerBackOff("king"),
    };
  }

  /** How long this card takes to arrive here. */
  public static double arrivalTime(Card card, Side side, double y) {
    return arrivalTime(card, side, y, Double.NaN);
  }

  public static double arrivalTime(Card card, Side side, double y, double x) {
    var cfg = Rules.config();
    if ("tunnel".equals(card.delivery())) {
      // A dig is a journey, so it is priced by how far it goes. Floored, so a
      // hole opened next to your own king still takes a moment.
      double[] king = kingSpot(side);
      double fromX = Double.isNaN(x) ? king[0] : x;
      double dug = Board.span(fromX - king[0], y - king[1]) / cfg.tunnelSpeed();
      return Math.round(Math.max(Rules.deliveryTime("tunnel"), dug) * 100) / 100.0;
    }
    if (!"throw".equals(card.delivery())) return card.deployDelay();
    var c = Rules.config();
    double from = side == Side.ONE ? c.arenaHeight() : 0;
    double flight = Math.abs(y - from) / c.throwSpeed();
    return Math.round(Math.max(c.throwMinTime(), flight) * 100) / 100.0;
  }

  public static boolean deploy(
      Match match, Side side, int slot, double x, double y, String form) {

    if (!canDeploy(match, side, slot, x, y)) return false;

    Card held = match.hand.get(side).get(slot);
    // A body chosen as part of this deployment rather than staged before it:
    // a deploy arriving over a wire is one self-describing message.
    if (form != null) Hand.chooseForm(match, side, held, form);

    double cost = Hand.costOf(match, side, held);
    match.elixir.put(side, match.elixir.get(side) - cost);

    // A copy card puts down what you played last; a form card picks a body.
    // Both resolve the card actually placed from the one in hand, and neither
    // changes the hand.
    Card copied = Hand.copyTarget(match, side, held);
    Card card = Hand.formOf(match, side, copied != null ? copied : held);

    // A card can put several bodies on the board; spread them so they do not
    // occupy the same point.
    double crowd = Rules.config().crowdRadius();
    for (int i = 0; i < card.count(); i++) {
      double offset = (i - (card.count() - 1) / 2.0) * crowd;
      spawn(match, card, side, x + offset, y);
    }

    if (copied == null) match.lastPlayed.put(side, card);
    // The choice is per play: leaving it set would silently apply to the next
    // one, which is exactly the decision the card exists to ask.
    match.form.remove(side);

    Hand.countPlay(match, side, card);
    // Always draw, even on the play that evolved the card. Skipping it used to
    // hand the player the evolution *and* let them keep their slot -- a free
    // rotation on top of a free stat increase, invisible on screen.
    Hand.drawFromDeck(match, side, slot);
    return true;
  }

  public static Unit spawn(Match match, Card card, Side side, double x, double y) {
    var c = Rules.config();
    Unit u = new Unit();
    u.id = match.nextId++;
    u.card = card;
    u.side = side;
    u.x = x;
    u.y = y;
    u.hp = card.hp();
    u.maxHP = card.hp();
    u.damage = card.damage();
    u.range = card.range();
    u.aggro = card.aggro();
    u.speed = card.speed();
    u.attackRate = card.attackRate();
    u.castEvery = card.castEvery();
    u.targets = card.targets();
    u.jumpsRiver = card.jumpsRiver();
    u.flying = card.flying();
    u.def = card.def();
    u.speDef = card.speDef();
    u.mass = card.mass();
    u.lane = x < c.arenaWidth() / 2.0 ? 0 : 1;
    u.facing = side == Side.ONE ? 4 : 0;   // side one walks up
    u.action = "Idle";
    /*
     * A tunneller starts at its own king and travels to where you put it:
     * Clash Royale's Miner. The journey is the cost and being untouchable
     * during it is the payoff.
     */
    u.digs = "tunnel".equals(card.delivery());
    if (u.digs) {
      double[] king = kingSpot(side);
      u.digFromX = king[0];
      u.digFromY = king[1];
      u.digToX = x;
      u.digToY = y;
      u.x = king[0];
      u.y = king[1];
    }
    u.spawning = arrivalTime(card, side, y, x);
    u.arriveTime = u.spawning;

    match.units.add(u);
    match.events.add(new MatchEvent.Spawn(u));
    return u;
  }
}
