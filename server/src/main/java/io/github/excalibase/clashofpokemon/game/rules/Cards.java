package io.github.excalibase.clashofpokemon.game.rules;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** The roster, loaded rather than derived. */
public final class Cards {

  private static final Map<String, Card> BY_ID;
  private static final List<Card> DECKABLE;
  private static final String VERSION;

  static {
    JsonNode root = read("rules.json");
    VERSION = root.get("version").asString();
    Map<String, Card> cards = new LinkedHashMap<>();
    for (JsonNode c : root.get("cards")) {
      cards.put(c.get("id").asString(), toCard(c));
    }
    BY_ID = frozen(cards);

    List<Card> deckable = new java.util.ArrayList<>();
    for (JsonNode c : root.get("cards")) {
      if (c.get("deckable").asBoolean()) deckable.add(BY_ID.get(c.get("id").asString()));
    }
    DECKABLE = List.copyOf(deckable);
  }

  private Cards() {}

  /** Any card that can appear on the board, including the evolved forms. */
  public static Card byId(String id) {
    return BY_ID.get(id);
  }

  /** The cards a deck may contain: 127 of the 262. */
  public static List<Card> all() {
    return DECKABLE;
  }

  /** Every card that can appear, in the order the wire numbers them. */
  public static List<Card> wireTable() {
    return List.copyOf(BY_ID.values());
  }

  /** A random legal deck, for a match nobody specified one for. */
  public static List<Card> newDeck(java.util.random.RandomGenerator rng) {
    List<Card> pool = new java.util.ArrayList<>(DECKABLE);
    List<Card> out = new java.util.ArrayList<>();
    int want = Rules.config().deckSize();
    while (out.size() < want && !pool.isEmpty()) {
      out.add(pool.remove((int) Math.floor(rng.nextDouble() * pool.size())));
    }
    return List.copyOf(out);
  }

  /** Which roster this is. Travels in the ticket; a mismatch is refused. */
  public static String version() {
    return VERSION;
  }

  private static Card toCard(JsonNode c) {
    return new Card(
        c.get("id").asString(),
        c.get("name").asString(),
        c.get("sheet").asString(),
        c.get("elixir").asInt(),
        c.get("hp").asInt(),
        c.get("damage").asInt(),
        c.get("range").asInt(),
        c.get("aggro").asInt(),
        c.get("speed").asDouble(),
        c.get("attackRate").asDouble(),
        c.get("castEvery").asInt(),
        c.get("def").asInt(),
        c.get("speDef").asInt(),
        c.get("mass").asDouble(),
        c.get("count").asInt(),
        c.get("flying").asBoolean(),
        c.get("jumpsRiver").asBoolean(),
        strings(c.get("targets")),
        c.get("skill").asString(),
        c.get("rarity").asString(),
        c.get("role").asString(),
        c.get("deployDelay").asDouble(),
        c.get("delivery").isNull() ? null : c.get("delivery").asString(),
        strings(c.get("forms")),
        c.get("stage").asInt(),
        c.get("skillAmount").asDouble(),
        c.get("skillResist").asString());
  }

  private static List<String> strings(JsonNode array) {
    return array == null ? List.of()
        : array.valueStream().map(JsonNode::asString).toList();
  }

  private static JsonNode read(String resource) {
    try (InputStream in = Cards.class.getClassLoader().getResourceAsStream(resource)) {
      if (in == null) {
        throw new IllegalStateException(
            resource + " missing -- run `npm run export:content` in phaser/");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("cannot read " + resource, e);
    }
  }

  /** Frozen, but still in the order the table was written. */
  private static <K, V> Map<K, V> frozen(Map<K, V> ordered) {
    return java.util.Collections.unmodifiableMap(new LinkedHashMap<>(ordered));
  }

}
