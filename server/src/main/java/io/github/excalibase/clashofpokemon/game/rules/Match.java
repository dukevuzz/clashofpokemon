package io.github.excalibase.clashofpokemon.game.rules;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;

/** A whole match, in one headless object. */
public final class Match {

  public final List<Unit> units = new ArrayList<>();
  public final List<Tower> towers = new ArrayList<>();
  public final List<Projectile> projectiles = new ArrayList<>();
  public List<MatchEvent> events = new ArrayList<>();

  public double time = Rules.config().matchSeconds();
  public double elapsed;
  /** "one", "two", "draw", or null while it is still being played. */
  public String over;

  public final Map<Side, Double> elixir = new EnumMap<>(Side.class);
  public final Map<Side, List<Card>> deck = new EnumMap<>(Side.class);
  public final Map<Side, List<Card>> hand = new EnumMap<>(Side.class);
  public final Map<Side, Integer> drawIndex = new EnumMap<>(Side.class);
  public final Map<Side, Map<String, Integer>> plays = new EnumMap<>(Side.class);
  public final Map<Side, String> troop = new EnumMap<>(Side.class);
  public final Map<Side, Card> lastPlayed = new EnumMap<>(Side.class);

  /** A body chosen for the next deployment. Cleared when it is used. */
  public final Map<Side, String> form = new EnumMap<>(Side.class);

  /** A branch offer waiting on an answer, per side. */
  public final Map<Side, PendingChoice> pendingChoice = new EnumMap<>(Side.class);
  public final Map<Side, String> preferredBranch = new EnumMap<>(Side.class);
  /** Which sides answer for themselves rather than being asked. */
  public final Map<Side, Boolean> bot = new EnumMap<>(Side.class);

  public final RandomGenerator rng;
  public int nextId = 1;
  private int choiceSeq;

  /** An evolution offer waiting on an answer. */
  public record PendingChoice(String id, int slot, Card from, List<Card> options) {}

  public static final class Options {
    public RandomGenerator rng = RandomGenerator.getDefault();
    public List<Card> deckOne;
    public List<Card> deckTwo;
    public String troopOne;
    public String troopTwo;
    public Map<Side, String> preferredBranch = Map.of();
    public Map<Side, Boolean> bot;
    /** False deals the deck in the order given, for tests that need a known hand. */
    public boolean shuffle = true;
  }

  public Match() {
    this(new Options());
  }

  public Match(Options opts) {
    this.rng = opts.rng;

    for (Side side : Side.values()) {
      preferredBranch.put(side, opts.preferredBranch.get(side));
      elixir.put(side, Rules.config().startElixir());
      drawIndex.put(side, Rules.config().handSize());
      plays.put(side, new HashMap<>());
      hand.put(side, new ArrayList<>());
    }
    preferredBranch.values().removeIf(java.util.Objects::isNull);

    // One human, one bot unless told otherwise, which keeps every single
    // player caller behaving exactly as it did.
    if (opts.bot != null) bot.putAll(opts.bot);
    else bot.put(Side.TWO, true);

    troop.put(Side.ONE, opts.troopOne != null ? opts.troopOne : Rules.troops().getFirst().id());
    troop.put(Side.TWO, opts.troopTwo != null ? opts.troopTwo : Rules.troops().getFirst().id());

    List<Card> one = opts.deckOne != null ? opts.deckOne : Cards.newDeck(rng);
    List<Card> two = opts.deckTwo != null ? opts.deckTwo : Cards.newDeck(rng);
    deck.put(Side.ONE, opts.shuffle ? shuffled(one, rng) : new ArrayList<>(one));
    deck.put(Side.TWO, opts.shuffle ? shuffled(two, rng) : new ArrayList<>(two));

    for (Side side : Side.values()) {
      for (int i = 0; i < Rules.config().handSize(); i++) {
        hand.get(side).add(deck.get(side).get(i));
      }
    }
    setupArena();
  }

  /** Shuffle a deck for one match, without disturbing the one that was saved. */
  private static List<Card> shuffled(List<Card> deck, RandomGenerator rng) {
    List<Card> out = new ArrayList<>(deck);
    for (int i = out.size() - 1; i > 0; i--) {
      int j = (int) Math.floor(rng.nextDouble() * (i + 1));
      Card swap = out.get(i);
      out.set(i, out.get(j));
      out.set(j, swap);
    }
    return out;
  }

  /** Names offers c1, c2... A counter, so a seed replays the same match. */
  public String nextChoiceId() {
    return "c" + (++choiceSeq);
  }

  // ------------------------------------------------------------------ arena

  private void setupArena() {
    var c = Rules.config();
    for (Side side : Side.values()) {
      double baseY = side == Side.ONE
          ? c.arenaHeight() - Rules.towerBackOff("side") : Rules.towerBackOff("side");
      double kingY = side == Side.ONE
          ? c.arenaHeight() - Rules.towerBackOff("king") : Rules.towerBackOff("king");
      addTower(side, "side", c.laneX().get(0), baseY);
      addTower(side, "side", c.laneX().get(1), baseY);
      addTower(side, "king", c.arenaWidth() / 2.0, kingY);
    }
  }

  private void addTower(Side side, String kind, double x, double y) {
    // A lane tower's statline comes from the creature riding it; a king's is
    // the game's own, because nobody rides a king.
    Troop rider = "side".equals(kind) ? Rules.troop(troop.get(side)) : null;

    Tower t = new Tower();
    t.id = nextId++;
    t.side = side;
    t.kind = kind;
    t.x = x;
    t.y = y;
    t.hp = rider != null ? rider.hp() : Rules.towerHP(kind);
    t.maxHP = t.hp;
    t.damage = rider != null ? rider.damage() : Rules.towerDamage(kind);
    t.range = rider != null
        ? rider.reach() + Rules.towerSize(kind) * 0.5
        : Rules.towerRange(kind);
    t.rate = rider != null ? rider.rate() : Rules.towerRate();
    t.volleyShots = rider != null ? rider.volleyShots() : null;
    t.volleyReload = rider != null ? rider.volleyReload() : null;
    t.ammo = t.volleyShots != null ? t.volleyShots : 0;
    // A king sleeps until a lane tower falls or something hits it, which is
    // what makes rushing the middle a real option rather than a way to die to
    // three towers at once.
    t.active = !"king".equals(kind);
    towers.add(t);
  }

  // ----------------------------------------------------------------- update

  /** Advance the match. Returns everything that happened since the last call. */
  public List<MatchEvent> update(double dt) {
    if (over != null) return drain();

    elapsed += dt;
    boolean wasDouble = time <= Rules.config().suddenDeathAt();
    time = Math.max(0, time - dt);

    boolean doubled = time <= Rules.config().suddenDeathAt();
    double rate = Rules.config().elixirRate() * (doubled ? 2 : 1);
    if (doubled && !wasDouble) { /* sudden death began */ }
    for (Side side : Side.values()) {
      elixir.put(side, Math.min(Rules.config().elixirMax(), elixir.get(side) + rate * dt));
    }

    Combat.updateProjectiles(this, dt);
    for (Unit u : List.copyOf(units)) {
      if (!u.dead) Tick.updateUnit(this, u, dt);
    }
    for (Tower t : towers) {
      if (!t.dead) Tick.updateTower(this, t, dt);
    }

    // Anything dead, or that walked off the far end, has nothing left to do.
    units.removeIf(u -> u.dead || u.y <= -20 || u.y >= Rules.config().arenaHeight() + 20);

    checkOver();
    return drain();
  }

  private List<MatchEvent> drain() {
    // Drained at the end rather than cleared at the start: `deploy` also
    // pushes events, and a caller that deploys between frames -- which every
    // caller does -- had those silently discarded on the next step. Every
    // spawn was lost that way.
    List<MatchEvent> out = events;
    events = new ArrayList<>();
    return out;
  }

  // ----------------------------------------------------------------- result

  public int towersLeft(Side side) {
    int n = 0;
    for (Tower t : towers) if (t.side == side && !t.dead) n++;
    return n;
  }

  /** Remaining tower health as a fraction: the tiebreak when time runs out. */
  public double towerHealth(Side side) {
    double hp = 0;
    double max = 0;
    for (Tower t : towers) {
      if (t.side != side) continue;
      hp += t.hp;
      max += t.maxHP;
    }
    return max > 0 ? hp / max : 0;
  }

  public boolean kingDown(Side side) {
    for (Tower t : towers) {
      if (t.side == side && "king".equals(t.kind) && t.dead) return true;
    }
    return false;
  }

  private void checkOver() {
    String result = null;
    if (kingDown(Side.TWO)) result = "one";
    else if (kingDown(Side.ONE)) result = "two";
    else if (time <= 0) {
      int a = towersLeft(Side.ONE);
      int b = towersLeft(Side.TWO);
      if (a != b) result = a > b ? "one" : "two";
      else {
        double ha = towerHealth(Side.ONE);
        double hb = towerHealth(Side.TWO);
        /*
         * 0.01 of a side's total tower health, not an exact tie.
         *
         * This read 1e-9 -- ten million times tighter than the rule the game
         * actually has -- so every near-tie that is a draw in the reference
         * engine was awarded here to whoever was a hair ahead. One match in
         * twenty-six landed inside the band and the two engines called a
         * different winner from identical tower health.
         *
         * A tenth of a percent of a tower is not a lead worth winning on.
         */
        result = Math.abs(ha - hb) < 0.01 ? "draw" : (ha > hb ? "one" : "two");
      }
    }
    if (result != null) {
      over = result;
      events.add(new MatchEvent.Over(result));
    }
  }

  // ------------------------------------------------------------- the player

  public double costOf(Side side, Card card) {
    return Hand.costOf(this, side, card);
  }

  public boolean canDeploy(Side side, int slot, double x, double y) {
    return Deploy.canDeploy(this, side, slot, x, y);
  }

  public boolean deploy(Side side, int slot, double x, double y) {
    return Deploy.deploy(this, side, slot, x, y, null);
  }

  public boolean deploy(Side side, int slot, double x, double y, String form) {
    return Deploy.deploy(this, side, slot, x, y, form);
  }

  public boolean takeChoice(Side side, String choiceId, String cardId) {
    return Hand.takeChoice(this, side, choiceId, cardId);
  }
}
