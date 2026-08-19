package io.github.excalibase.clashofpokemon.game.rules;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Type advantage, from the same table the client draws. */
public final class TypeChart {

  private record Row(Set<String> immune, Set<String> strong, Set<String> weak) {}

  private static final Map<String, Row> CHART = loadChart();
  private static final Map<String, List<String>> TYPES = loadTypes();

  private TypeChart() {}

  /** How hard {@code attacker} hits {@code defender}, by species name. */
  public static double multiplier(String attacker, String defender) {
    List<String> defending = TYPES.getOrDefault(defender, List.of());
    List<String> attacking = TYPES.getOrDefault(attacker, List.of());
    if (defending.isEmpty()) return 1;

    double best = 0;
    for (String attack : attacking) {
      Row row = CHART.get(attack);
      if (row == null) continue;
      double mult = 1;
      for (String defend : defending) {
        if (row.immune().contains(defend)) mult = 0;
        else if (row.strong().contains(defend)) mult *= 2;
        else if (row.weak().contains(defend)) mult *= 0.5;
      }
      if (mult > best) best = mult;
    }
    // Nothing to attack with is neutral, not harmless -- a creature with no
    // usable type must still be able to hurt something.
    if (best == 0 && attacking.isEmpty()) return 1;
    return best;
  }

  private static Map<String, Row> loadChart() {
    JsonNode chart = read("typeChart.json").get("chart");
    return chart.propertyStream().collect(java.util.stream.Collectors.toMap(
        Map.Entry::getKey,
        e -> new Row(names(e.getValue(), "immune"),
                     names(e.getValue(), "strong"),
                     names(e.getValue(), "weak"))));
  }

  private static Set<String> names(JsonNode row, String field) {
    JsonNode list = row.get(field);
    if (list == null) return Set.of();
    return list.valueStream().map(JsonNode::asString)
        .collect(java.util.stream.Collectors.toUnmodifiableSet());
  }

  /** A creature's real types, which are not the ones the species data lists. */
  private static Map<String, List<String>> loadTypes() {
    JsonNode chart = read("typeChart.json");
    JsonNode canon = chart.get("canon");
    JsonNode extra = chart.get("extra");
    JsonNode species = read("species.json");

    Map<String, List<String>> types = new java.util.HashMap<>();
    for (Map.Entry<String, JsonNode> entry : species.propertyStream().toList()) {
      List<String> out = new java.util.ArrayList<>();
      JsonNode raw = entry.getValue().get("types");
      if (raw != null) {
        for (JsonNode t : raw) {
          JsonNode mapped = canon.get(t.asString());
          if (mapped == null) continue;
          String name = mapped.asString();
          if (!out.contains(name)) out.add(name);
        }
      }
      JsonNode bonus = extra.get(entry.getKey());
      if (bonus != null && !out.contains(bonus.asString())) out.add(bonus.asString());
      types.put(entry.getKey(), List.copyOf(out));
    }
    return frozen(types);
  }

  private static JsonNode read(String resource) {
    try (InputStream in = TypeChart.class.getClassLoader().getResourceAsStream(resource)) {
      if (in == null) throw new IllegalStateException("missing resource: " + resource);
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
