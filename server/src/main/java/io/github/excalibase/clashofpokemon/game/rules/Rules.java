package io.github.excalibase.clashofpokemon.game.rules;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Every number the rules use, loaded rather than retyped. */
public final class Rules {

  private static final JsonNode ROOT = read();

  private Rules() {}

  /** Board and match constants. */
  public record Config(
      int arenaWidth, int arenaHeight,
      double riverY, double riverHeight,
      List<Double> bridgeX, double bridgeHalfWidth,
      List<Double> laneX,
      double elixirMax, double elixirRate, double startElixir,
      double matchSeconds, double suddenDeathAt,
      int deckSize, int handSize,
      double unitSize, double crowding,
      boolean riverBypass, double leapTime, double bridgeApproach,
      double deployMargin, double kingWakeSeconds,
      double dropRadius, double dropDamage,
      double throwSpeed, double throwMinTime,
      double aggroArc, double projectileSpeed,
      double tunnelSpeed) {

    /** How close two creatures may stand. Derived so art and physics agree. */
    public double crowdRadius() {
      return unitSize * crowding;
    }
  }

  private static final Config CONFIG = readConfig();

  public static Config config() {
    return CONFIG;
  }

  public static String version() {
    return ROOT.get("version").asString();
  }

  /** How wide a tower stands, by kind. */
  public static double towerSize(String kind) {
    return ROOT.get("config").get("towerSize").get(kind).asDouble();
  }

  /** How far a tower's box reaches above and below its centre. */
  public static double towerBox(String kind, String direction) {
    return ROOT.get("config").get("towerBox").get(kind).get(direction).asDouble();
  }

  /**
   * Bearings for creatures standing exactly on top of each other.
   *
   * Read from the generated rules rather than computed with sin and cos. IEEE
   * 754 requires sqrt to be correctly rounded and requires nothing of the kind
   * from trigonometry, so V8's values differ from the JVM's in the last bit --
   * which is how two stacked creatures ended up fractionally apart in the two
   * engines, and a few seconds later one struck a blow the other did not.
   */
  private static final double[][] SPREAD = readSpread();

  private static double[][] readSpread() {
    JsonNode node = ROOT.get("spread");
    double[][] out = new double[node.size()][2];
    for (int i = 0; i < node.size(); i++) {
      out[i][0] = node.get(i).get(0).asDouble();
      out[i][1] = node.get(i).get(1).asDouble();
    }
    return out;
  }

  /** The bearing for the nth body in a stack, wrapping for very large stacks. */
  public static double[] spreadFor(int i) {
    return SPREAD[Math.floorMod(i, SPREAD.length)];
  }

  /** The floor on a delivery, by kind: tunnel, throw or drop. */
  public static double deliveryTime(String kind) {
    return ROOT.get("config").get("deliveryTime").get(kind).asDouble();
  }

  /** How far back from the board's edge a tower stands. */
  public static double towerBackOff(String kind) {
    return ROOT.get("config").get("towerBackOff").get(kind).asDouble();
  }

  public static double towerRange(String kind) {
    return ROOT.get("config")
        .get("side".equals(kind) ? "towerRangeSide" : "towerRangeKing").asDouble();
  }

  public static int towerHP(String kind) {
    return ROOT.get("config").get("towerHP").get(kind).asInt();
  }

  static Map<Integer, Integer> playsForStage() {
    Map<Integer, Integer> out = new LinkedHashMap<>();
    for (var e : ROOT.get("evolution").get("playsForStage").propertyStream().toList()) {
      out.put(Integer.parseInt(e.getKey()), e.getValue().asInt());
    }
    return frozen(out);
  }

  static int branchOffer() {
    return ROOT.get("evolution").get("branchOffer").asInt();
  }

  static Map<String, String> evolutionNext() {
    Map<String, String> out = new LinkedHashMap<>();
    for (var e : ROOT.get("evolution").get("next").propertyStream().toList()) {
      out.put(e.getKey(), e.getValue().asString());
    }
    return frozen(out);
  }

  static Map<String, Integer> evolutionStage() {
    Map<String, Integer> out = new LinkedHashMap<>();
    for (var e : ROOT.get("evolution").get("stage").propertyStream().toList()) {
      out.put(e.getKey(), e.getValue().asInt());
    }
    return frozen(out);
  }

  static Map<String, List<String>> evolutionBranches() {
    Map<String, List<String>> out = new LinkedHashMap<>();
    for (var e : ROOT.get("evolution").get("branches").propertyStream().toList()) {
      out.put(e.getKey(), e.getValue().valueStream().map(JsonNode::asString).toList());
    }
    return frozen(out);
  }

  private static final Map<String, Troop> TROOPS = readTroops();

  public static Troop troop(String id) {
    Troop t = TROOPS.get(id);
    return t != null ? t : TROOPS.values().iterator().next();
  }

  public static List<Troop> troops() {
    return List.copyOf(TROOPS.values());
  }

  public static int towerDamage(String kind) {
    return ROOT.get("towerDamage").get(kind).asInt();
  }

  public static double towerRate() {
    return ROOT.get("towerRate").asDouble();
  }

  private static Map<String, Troop> readTroops() {
    Map<String, Troop> out = new LinkedHashMap<>();
    for (JsonNode t : ROOT.get("troops")) {
      out.put(t.get("id").asString(), new Troop(
          t.get("id").asString(), t.get("name").asString(), t.get("species").asString(),
          t.get("hp").asInt(), t.get("damage").asInt(),
          t.get("reach").asDouble(), t.get("rate").asDouble(),
          t.get("volleyShots").isNull() ? null : t.get("volleyShots").asInt(),
          t.get("volleyReload").isNull() ? null : t.get("volleyReload").asDouble()));
    }
    return frozen(out);
  }

  static double skillDouble(String field) {
    return ROOT.get("skills").get(field).asDouble();
  }

  static Map<String, Skills.Effect> moveEffects() {
    Map<String, Skills.Effect> out = new LinkedHashMap<>();
    for (var e : ROOT.get("skills").get("moveEffect").propertyStream().toList()) {
      JsonNode v = e.getValue();
      String kind = v.get("kind").asString();
      // One field carries the number whatever the effect is called: a heal has
      // a fraction, a shield an amount, a buff a multiplier, a blink a distance.
      double amount = switch (kind) {
        case "heal" -> v.get("fraction").asDouble();
        case "buff" -> v.get("multiplier").asDouble();
        case "blink" -> v.get("distance").asDouble();
        default -> v.get("amount").asDouble();
      };
      String stat = v.has("stat") ? v.get("stat").asString() : null;
      out.put(e.getKey(), new Skills.Effect(kind, amount, stat));
    }
    return frozen(out);
  }

  static Map<String, Skills.Powered> poweredMoves() {
    Map<String, Skills.Powered> out = new LinkedHashMap<>();
    for (var e : ROOT.get("skills").get("powered").propertyStream().toList()) {
      JsonNode v = e.getValue();
      out.put(e.getKey(), new Skills.Powered(
          v.get("from").asString(),
          doubles(v.get("scale")),
          v.has("boostDef") ? doubles(v.get("boostDef")) : List.of()));
    }
    return frozen(out);
  }

  static Map<String, Statuses.Effect> moveStatuses() {
    Map<String, Statuses.Effect> out = new LinkedHashMap<>();
    for (Map.Entry<String, JsonNode> e
        : ROOT.get("statuses").get("moves").propertyStream().toList()) {
      JsonNode v = e.getValue();
      out.put(e.getKey(), new Statuses.Effect(
          StatusKind.of(v.get("kind").asString()),
          v.get("seconds").asDouble(),
          v.get("chance").asDouble()));
    }
    return frozen(out);
  }

  private static Config readConfig() {
    JsonNode c = ROOT.get("config");
    return new Config(
        c.get("arenaWidth").asInt(),
        c.get("arenaHeight").asInt(),
        c.get("riverY").asDouble(),
        c.get("riverHeight").asDouble(),
        doubles(c.get("bridgeX")),
        c.get("bridgeHalfWidth").asDouble(),
        doubles(c.get("laneX")),
        c.get("elixirMax").asDouble(),
        c.get("elixirRate").asDouble(),
        c.get("startElixir").asDouble(),
        c.get("matchSeconds").asDouble(),
        c.get("suddenDeathAt").asDouble(),
        c.get("deckSize").asInt(),
        c.get("handSize").asInt(),
        c.get("unitSize").asDouble(),
        c.get("crowding").asDouble(),
        c.get("riverBypass").asBoolean(),
        c.get("leapTime").asDouble(),
        c.get("bridgeApproach").asDouble(),
        c.get("deployMargin").asDouble(),
        c.get("kingWakeSeconds").asDouble(),
        c.get("dropImpact").get("radius").asDouble(),
        c.get("dropImpact").get("damage").asDouble(),
        c.get("throwSpeed").asDouble(),
        c.get("throwMinTime").asDouble(),
        c.get("aggroArc").asDouble(),
        c.get("projectileSpeed").asDouble(),
        c.get("tunnelSpeed").asDouble());
  }

  private static List<Double> doubles(JsonNode array) {
    return array == null ? List.of()
        : array.valueStream().map(JsonNode::asDouble).toList();
  }

  private static JsonNode read() {
    try (InputStream in = Rules.class.getClassLoader().getResourceAsStream("rules.json")) {
      if (in == null) {
        throw new IllegalStateException(
            "rules.json missing -- run `npm run export:content` in phaser/");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("cannot read rules.json", e);
    }
  }

  /** Frozen, but still in the order the table was written. */
  private static <K, V> Map<K, V> frozen(Map<K, V> ordered) {
    return java.util.Collections.unmodifiableMap(new LinkedHashMap<>(ordered));
  }

}
