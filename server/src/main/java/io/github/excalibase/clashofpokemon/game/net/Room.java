package io.github.excalibase.clashofpokemon.game.net;

import io.github.excalibase.clashofpokemon.game.rules.Card;
import io.github.excalibase.clashofpokemon.game.rules.Cards;
import io.github.excalibase.clashofpokemon.game.rules.Match;
import io.github.excalibase.clashofpokemon.game.rules.MatchEvent;
import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import io.github.excalibase.clashofpokemon.game.rules.Tower;
import io.github.excalibase.clashofpokemon.game.rules.Unit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;

/** One match, hosted. */
public final class Room {

  private static final double STEP = 1.0 / Protocol.TICK_HZ;

  /** How long a *connected* seat has to say its art is loaded. */
  static final long LOADING_GRACE_MS = 90_000;

  /** How long a seat that *dropped* before the start has to come back. */
  static final long RELOAD_GRACE_MS = 30_000;

  /** How long a match with nobody watching keeps running. */
  static final long AWAY_GRACE_MS = 120_000;

  public final String id;
  public final Match match;
  public final long seed;

  private final Map<Side, Seat> seats = new EnumMap<>(Side.class);
  private final boolean packSnapshots;
  private final Consumer<Room> onEnd;

  private long tick;
  private long startedAt;
  /** When this room was first swept, and whether it has been. */
  private boolean seen;
  private long firstSeen;
  private long aloneSince;
  private boolean alone;
  private boolean missing;
  private long missingSince;
  private long endedAt;
  private boolean running;
  private boolean ended;

  /** Ids already sent, so a spawn is announced exactly once. */
  private final Set<Integer> announced = new HashSet<>();
  private List<Wire.Event> pending = new ArrayList<>();

  public Room(String id, Seat one, Seat two, long seed) {
    this(id, one, two, seed, true, room -> {});
  }

  public Room(String id, Seat one, Seat two, long seed,
              boolean packSnapshots, Consumer<Room> onEnd) {
    this.id = id;
    this.seed = seed;
    this.packSnapshots = packSnapshots;
    this.onEnd = onEnd;
    seats.put(one.side, one);
    seats.put(two.side, two);

    Seat first = seats.get(Side.ONE);
    Seat second = seats.get(Side.TWO);

    Match.Options opts = new Match.Options();
    opts.rng = mulberry32((int) seed);
    opts.deckOne = deckOf(first.deck);
    opts.deckTwo = deckOf(second.deck);
    opts.troopOne = first.troop;
    opts.troopTwo = second.troop;
    Map<Side, String> branches = new EnumMap<>(Side.class);
    if (first.branch != null) branches.put(Side.ONE, first.branch);
    if (second.branch != null) branches.put(Side.TWO, second.branch);
    opts.preferredBranch = branches;
    // Nobody is a bot: both seats are people, so both get asked.
    opts.bot = Map.of();

    this.match = new Match(opts);
  }

  /** Deterministic per match, seeded by the server. */
  static RandomGenerator mulberry32(int seed) {
    return new RandomGenerator() {
      private int a = seed;

      @Override public double nextDouble() {
        a = a + 0x6d2b79f5;
        int t = a;
        t = (t ^ (t >>> 15)) * (1 | t);
        t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
        return ((t ^ (t >>> 14)) & 0xffffffffL) / 4294967296.0;
      }

      @Override public long nextLong() {
        return (long) (nextDouble() * Long.MAX_VALUE);
      }
    };
  }

  /** A deck of cards, from a deck of names. */
  static List<Card> deckOf(List<String> ids) {
    List<Card> deck = new ArrayList<>();
    for (String id : ids) {
      Card c = Cards.byId(id);
      if (c != null && Cards.all().contains(c) && !deck.contains(c)) deck.add(c);
    }
    return deck;
  }

  private List<Seat> both() {
    return List.copyOf(seats.values());
  }

  public Seat seat(Side side) {
    return seats.get(side);
  }

  /** Greet each seat with who they are and where they are sitting. */
  public void greet() {
    for (Seat s : both()) s.send(helloFor(s));
  }

  private Wire.Hello helloFor(Seat s) {
    Seat them = both().stream().filter(o -> o != s).findFirst().orElseThrow();
    return new Wire.Hello(id, s.account.id(), s.side,
        new Wire.Deck(s.deck, s.troop),
        new Wire.Them(them.account.id(), them.account.name(), them.deck, them.troop));
  }

  /** Start once both seats say their art is ready. */
  public boolean maybeStart(long now) {
    if (running || ended) return false;
    for (Seat s : both()) {
      if (!s.loaded()) return false;
    }
    startedAt = now;
    running = true;
    for (Seat s : both()) s.send(new Wire.Start(seed, startedAt));
    return true;
  }

  /** Give up on this room, if it is time to. */
  public void sweep(long now) {
    if (ended) return;
    if (!seen) {
      seen = true;
      firstSeen = now;
    }

    if (!running) {
      // Two clocks, and the shorter one only runs while somebody is missing.
      // A seat that is connected is loading; a seat that is gone is not, and
      // waiting ninety seconds for it punishes the player who did turn up.
      boolean anyoneMissing = both().stream().anyMatch(s -> !s.live());
      if (anyoneMissing) {
        if (!missing) {
          missing = true;
          missingSince = now;
        }
      } else {
        missing = false;
      }

      boolean waited = now - firstSeen >= LOADING_GRACE_MS
          || (missing && now - missingSince >= RELOAD_GRACE_MS);
      if (!waited) return;

      // Somebody is here and ready. Start without the other one: the player
      // who turned up should get their match, and the one who did not loses
      // by not playing -- which is far better than both being stuck.
      boolean anyone = both().stream().anyMatch(Seat::loaded);
      if (anyone) {
        startedAt = now;
        running = true;
        for (Seat s : both()) s.send(new Wire.Start(seed, startedAt));
        return;
      }
      // Neither of them ever arrived, so neither of them lost. A forfeit here
      // would punish whichever connection happened to drop first.
      abandon(now);
      return;
    }

    if (both().stream().anyMatch(Seat::live)) {
      alone = false;
      return;
    }
    if (!alone) {
      alone = true;
      aloneSince = now;
      return;
    }
    if (now - aloneSince > AWAY_GRACE_MS) abandon(now);
  }

  /** Nobody played it, so nobody won it. */
  private void abandon(long now) {
    finish("draw", now);
    lastReason = "abandoned";
  }

  /** One simulation frame. Called by whoever is hosting; the room owns no timer. */
  public void step(long now) {
    if (!running || ended) return;
    tick++;
    for (MatchEvent e : match.update(STEP)) pending.addAll(Wire.toWire(e));
    if (tick % Protocol.TICKS_PER_SNAP == 0) broadcast();
    if (match.over != null) finish(null, now);
  }

  /** One board, two tails. */
  private void broadcast() {
    List<Snapshot.UnitSnap> units = new ArrayList<>(match.units.size());
    List<Wire.Event> fresh = new ArrayList<>();

    for (Unit u : match.units) {
      if (announced.add(u.id)) {
        // A spawn may already be in `pending`; announcing from the live list
        // as well is what makes a reconnecting client whole with no special path.
        boolean already = pending.stream()
            .anyMatch(p -> p instanceof Wire.Event.Spawn s && s.id() == u.id);
        if (!already) fresh.add(Wire.spawnEvent(u));
      }
      units.add(snapUnit(u));
    }

    List<Snapshot.TowerSnap> towers = new ArrayList<>(match.towers.size());
    for (Tower t : match.towers) towers.add(snapTower(t));

    List<Snapshot.ShotSnap> shots = new ArrayList<>(match.projectiles.size());
    for (var p : match.projectiles) shots.add(new Snapshot.ShotSnap(round1(p.x), round1(p.y)));

    List<Wire.Event> all = new ArrayList<>(fresh);
    all.addAll(pending);
    pending = new ArrayList<>();

    for (Seat s : both()) {
      if (!s.live()) continue;

      // An evolution offer belongs to one seat.
      List<Wire.Event> mine = all.stream()
          .filter(e -> !(e instanceof Wire.Event.Choice c) || c.side() == s.side.wire())
          .toList();
      if (!mine.isEmpty()) s.send(new Wire.Ev(tick, mine));

      Snapshot.Snap snap = new Snapshot.Snap(tick, round1(match.time), units, towers, shots,
          new Snapshot.Own(round2(match.elixir.get(s.side)), handOf(s.side), nextCard(s.side)));

      // Packed by default. The one thing binary costs is the ability to read a
      // message in devtools -- and that is how the deck-ordering deadlock was
      // found -- so it stays switchable.
      if (packSnapshots) s.sendBinary(Snapshot.encode(snap));
      else s.send(readable(snap));
    }
  }

  /** Everything a client needs to draw a match it has just joined. */
  public void resync(Seat s) {
    s.send(helloFor(s));
    s.send(new Wire.Start(seed, startedAt));

    // Every creature on the board, as if it had just spawned. The alternative
    // is a second "here is one you missed" message that only runs after
    // something has gone wrong, and therefore only breaks after that too.
    List<Wire.Event> events = new ArrayList<>();
    for (Unit u : match.units) {
      announced.add(u.id);
      events.add(Wire.spawnEvent(u));
    }
    var offer = match.pendingChoice.get(s.side);
    if (offer != null) events.addAll(Wire.toWire(
        new MatchEvent.Choice(s.side, offer.id(), offer.from(), offer.options())));

    if (!events.isEmpty()) s.send(new Wire.Ev(tick, events));
  }

  // ------------------------------------------------------------------ intents

  public void loaded(Seat s, long now) {
    s.markLoaded();
    maybeStart(now);
  }

  /** Somebody came back. */
  public void rejoin(Seat s, long now) {
    if (running) s.markLoaded();
    setLive(s.side, true);
    maybeStart(now);
  }

  public void ping(Seat s, long c) {
    s.send(new Wire.Pong(c, tick));
  }

  /** A play. Everything is checked; nothing is trusted. */
  public void deploy(Seat s, long seq, int slot, double x, double y, String form) {
    Protocol.Reject why = refuseDeploy(s, slot, x, y);
    if (why != null) {
      s.send(new Wire.Reject(seq, why));
      return;
    }
    // The same call the single-player screen makes. Legality has one
    // implementation, in the rules, used by both.
    if (!match.deploy(s.side, slot, x, y, form)) {
      s.send(new Wire.Reject(seq, Protocol.Reject.ZONE));
    }
  }

  public void choose(Seat s, long seq, String choiceId, String cardId) {
    if (!running) {
      s.send(new Wire.Reject(seq, Protocol.Reject.NOTSTARTED));
      return;
    }
    if (!match.takeChoice(s.side, choiceId, cardId)) {
      s.send(new Wire.Reject(seq, Protocol.Reject.STALE));
    }
  }

  public void leave(Seat s, long now) {
    finish(s.side == Side.ONE ? "two" : "one", now);
  }

  /** Why this play is not allowed, or null. */
  private Protocol.Reject refuseDeploy(Seat s, int slot, double x, double y) {
    if (!running) return Protocol.Reject.NOTSTARTED;
    if (match.over != null) return Protocol.Reject.OVER;
    List<Card> hand = match.hand.get(s.side);
    if (slot < 0 || slot >= hand.size() || hand.get(slot) == null) return Protocol.Reject.SLOT;
    if (match.elixir.get(s.side) < match.costOf(s.side, hand.get(slot))) {
      return Protocol.Reject.ELIXIR;
    }
    if (!match.canDeploy(s.side, slot, x, y)) return Protocol.Reject.ZONE;
    return null;
  }

  // ----------------------------------------------------------------- sockets

  /** A seat went away. The match does not care, which is the point. */
  public void setLive(Side side, boolean live) {
    Seat s = seats.get(side);
    if (s == null || s.live() == live) return;
    if (!live) s.detach();
    both().stream().filter(o -> o != s).findFirst()
        .ifPresent(other -> other.send(new Wire.Peer(live)));
  }

  /** Point a seat at a socket. */
  public Seat attach(Side side, Seat.Channel channel) {
    Seat s = seats.get(side);
    if (s == null) return null;
    s.attach(channel);
    return s;
  }

  private void finish(String forced, long now) {
    if (ended) return;
    ended = true;
    running = false;

    String result = forced != null ? forced : match.over != null ? match.over : "draw";
    for (Seat s : both()) {
      String wire = Wire.seatResult(result);
      boolean won = result.equals(s.side == Side.ONE ? "one" : "two");
      if (s.live()) s.send(new Wire.Over(wire, won));
    }
    lastResult = result;
    lastReason = forced != null ? "forfeit" : match.time <= 0 ? "time" : "kingDown";
    durationMs = Math.max(0, now - startedAt);
    endedAt = now;
    onEnd.accept(this);
  }

  private String lastResult;
  private String lastReason;
  private long durationMs;

  /** What to tell the meta tier. */
  public Report report() {
    List<Report.Player> players = new ArrayList<>();
    for (Seat s : both()) {
      players.add(new Report.Player(s.account.id(), s.side == Side.ONE ? 1 : 2, 1));
    }
    String outcome = switch (lastResult == null ? "draw" : lastResult) {
      case "one" -> "team1";
      case "two" -> "team2";
      default -> "draw";
    };
    return new Report(id, outcome, lastReason == null ? "unknown" : lastReason,
        durationMs, Cards.version(), players);
  }

  public record Report(String matchId, String outcome, String reason, long durationMs,
                       String contentVersion, List<Player> players) {
    public record Player(String accountId, int team, int seat) {}
  }

  public boolean running() {
    return running;
  }

  /** When this room finished, on the host's clock. Zero while it is still going. */
  public long endedAt() {
    return endedAt;
  }

  public boolean finished() {
    return ended;
  }

  public long tick() {
    return tick;
  }

  /** Stop hosting. Used when both seats have gone for good. */
  public void dispose() {
    running = false;
    ended = true;
  }

  // ---------------------------------------------------------------- sampling

  private static double round1(double n) {
    return Math.round(n * 10) / 10.0;
  }

  private static double round2(double n) {
    return Math.round(n * 100) / 100.0;
  }

  private static Snapshot.UnitSnap snapUnit(Unit u) {
    List<String> kinds = new ArrayList<>(u.statuses.size());
    for (var s : u.statuses) kinds.add(s.kind.wire());
    return new Snapshot.UnitSnap(u.id, round1(u.x), round1(u.y), u.hp, u.shield,
        Protocol.actionCode(u.action), u.facing, round1(Math.max(0, u.spawning)),
        Protocol.statusBits(kinds));
  }

  private static Snapshot.TowerSnap snapTower(Tower t) {
    return new Snapshot.TowerSnap(t.id, t.hp, t.active ? 1 : 0, round1(t.waking), t.ammo);
  }

  private List<String> handOf(Side side) {
    List<String> hand = new ArrayList<>(Rules.config().handSize());
    for (Card c : match.hand.get(side)) hand.add(c == null ? null : c.id());
    return hand;
  }

  /** The next card the cycle will deal, which the client shows beside the hand. */
  private String nextCard(Side side) {
    List<Card> deck = match.deck.get(side);
    List<Card> hand = match.hand.get(side);
    for (int n = 0; n < deck.size(); n++) {
      Card c = deck.get((match.drawIndex.get(side) + n) % deck.size());
      if (!hand.contains(c)) return c.id();
    }
    return null;
  }

  private static Wire.Snap readable(Snapshot.Snap s) {
    List<List<Number>> u = new ArrayList<>();
    for (Snapshot.UnitSnap x : s.units()) {
      u.add(List.of(x.id(), x.x(), x.y(), x.hp(), x.shield(),
          x.action(), x.facing(), x.spawning(), x.status()));
    }
    List<List<Number>> w = new ArrayList<>();
    for (Snapshot.TowerSnap x : s.towers()) {
      w.add(List.of(x.id(), x.hp(), x.active(), x.waking(), x.ammo()));
    }
    List<List<Number>> p = new ArrayList<>();
    for (Snapshot.ShotSnap x : s.shots()) p.add(List.of(x.x(), x.y()));

    return new Wire.Snap("snap", s.tick(), s.left(), u, w, p,
        new Wire.Own(s.me().elixir(), s.me().hand(), s.me().next()));
  }
}
