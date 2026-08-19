package io.github.excalibase.clashofpokemon.game.net;

import io.github.excalibase.clashofpokemon.game.rules.Card;
import io.github.excalibase.clashofpokemon.game.rules.MatchEvent;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import io.github.excalibase.clashofpokemon.game.rules.Tower;
import io.github.excalibase.clashofpokemon.game.rules.Unit;
import java.util.ArrayList;
import java.util.List;

/** What the server says, as JSON. */
public final class Wire {

  private Wire() {}

  /** Every message the server can send. Sealed, so a new one must be handled. */
  public sealed interface Msg {}

  /** An id and a name. Everything else about a player lives in the meta tier. */
  public record Account(String id, String name) {}

  public record Deck(List<String> deck, String troop) {}

  public record Them(String id, String name, List<String> deck, String troop) {}

  /** Who you are, where you are sitting, and what both decks are. */
  public record Hello(String t, int v, String matchId, String you, int seat,
                      int tick, int snap, Deck me, Them them) implements Msg {
    public Hello(String matchId, String you, Side seat, Deck me, Them them) {
      this("hello", Protocol.VERSION, matchId, you, seat.wire(),
          Protocol.TICK_HZ, Protocol.SNAP_HZ, me, them);
    }
  }

  /** The clock has started. Both seats are loaded and the board is live. */
  public record Start(String t, long seed, long startedAt) implements Msg {
    public Start(long seed, long startedAt) {
      this("start", seed, startedAt);
    }
  }

  /** A private room is open and waiting for one more. */
  public record Invite(String t, String code) implements Msg {
    public Invite(String code) {
      this("invite", code);
    }
  }

  public record Ev(String t, long tick, List<Event> e) implements Msg {
    public Ev(long tick, List<Event> e) {
      this("ev", tick, e);
    }
  }

  public record Over(String t, String result, boolean youWon) implements Msg {
    public Over(String result, boolean youWon) {
      this("over", result, youWon);
    }
  }

  /** An intent the rules refused. `seq` names which one. */
  public record Reject(String t, long seq, String code) implements Msg {
    public Reject(long seq, Protocol.Reject why) {
      this("reject", seq, why.wire());
    }
  }

  public record Peer(String t, String state) implements Msg {
    public Peer(boolean connected) {
      this("peer", connected ? "connected" : "disconnected");
    }
  }

  public record Pong(String t, long c, long tick) implements Msg {
    public Pong(long c, long tick) {
      this("pong", c, tick);
    }
  }

  public record Error(String t, String message) implements Msg {
    public Error(String message) {
      this("error", message);
    }
  }

  /** A readable snapshot, for when packing is turned off. */
  public record Snap(String t, long tick, double left,
                     List<List<Number>> u, List<List<Number>> w, List<List<Number>> p,
                     Own me) implements Msg {}

  public record Own(double e, List<String> hand, String next) {}

  // ------------------------------------------------------------------ events

  /** One thing that happened, with ids where the rules have object references. */
  public sealed interface Event {
    String e();

    // Nested inside the interface, because the protocol has both an `over` *message* and an `over` *event* and they are different shapes.
    record Spawn(String e, int id, String card, int side, int lane,
                 double x, double y, double arrive) implements Event {}

    record Ready(String e, int id) implements Event {}

    /** `from` is the id of whatever dealt it, absent for burn and poison. */
    record Hit(String e, int id, int amount, double mult, Integer from) implements Event {}

    /** `at` is what the cast was aimed at. */
    record Cast(String e, int id, String skill, Integer at) implements Event {}

    record Status(String e, int id, String kind, double seconds) implements Event {}

    record Shot(String e, Integer from, Integer to, int amount, double mult)
        implements Event {}

    record Death(String e, int id, boolean tower) implements Event {}

    record TowerDown(String e, int id) implements Event {}

    record KingWakes(String e, int id) implements Event {}

    /** Here `from` and `to` are card ids, which is why one record could not do. */
    record Evolve(String e, int side, String from, String to) implements Event {}

    /** `id` names the offer, so an answer cannot be applied to the wrong one. */
    record Choice(String e, int side, String id, String from, List<String> options)
        implements Event {}

    record Over(String e, String result) implements Event {}
  }

  private static double round1(double n) {
    return Math.round(n * 10) / 10.0;
  }

  public static Event spawnEvent(Unit u) {
    return new Event.Spawn("spawn", u.id, u.card.id(), u.side.wire(), u.lane,
        round1(u.x), round1(u.y), u.arriveTime);
  }

  /** The rules carry object references; the wire carries ids. */
  public static List<Event> toWire(MatchEvent e) {
    List<Event> out = new ArrayList<>(1);
    switch (e) {
      case MatchEvent.Spawn s -> out.add(spawnEvent(s.unit()));
      case MatchEvent.Ready r -> out.add(new Event.Ready("ready", r.unit().id));
      case MatchEvent.Hit h -> out.add(new Event.Hit("hit", h.target().id(), h.amount(), h.mult(),
          h.source() == null ? null : h.source().id()));
      case MatchEvent.Cast c -> out.add(new Event.Cast("cast", c.unit().id, c.skill(),
          c.target() == null ? null : c.target().id()));
      case MatchEvent.Afflicted a -> out.add(new Event.Status("status", a.unit().id,
          a.kind().wire(), a.seconds()));
      case MatchEvent.Shot s -> out.add(new Event.Shot("shot", s.from().id(), s.to().id(),
          s.amount(), s.mult()));
      case MatchEvent.Death d -> out.add(new Event.Death("death", d.thing().id(),
          d.thing() instanceof Tower));
      case MatchEvent.TowerDown t -> out.add(new Event.TowerDown("towerDown", t.tower().id));
      case MatchEvent.KingWakes k -> out.add(new Event.KingWakes("kingWakes", k.tower().id));
      case MatchEvent.Evolve v -> out.add(new Event.Evolve("evolve", v.side().wire(),
          v.from().id(), v.to().id()));
      case MatchEvent.Choice c -> out.add(choice(c));
      case MatchEvent.Over o -> out.add(new Event.Over("over", seatResult(o.result())));
    }
    return out;
  }

  private static Event.Choice choice(MatchEvent.Choice c) {
    List<String> options = new ArrayList<>();
    for (Card card : c.options()) options.add(card.id());
    return new Event.Choice("choice", c.side().wire(), c.id(), c.from().id(), options);
  }

  /** The rules name the winner by seat; the wire names it by end of the arena. */
  public static String seatResult(String result) {
    return switch (result) {
      case "one" -> "player";
      case "two" -> "enemy";
      default -> "draw";
    };
  }
}
