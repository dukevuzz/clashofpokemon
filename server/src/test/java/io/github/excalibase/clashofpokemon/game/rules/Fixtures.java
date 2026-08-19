package io.github.excalibase.clashofpokemon.game.rules;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.io.InputStream;

/** The answers the TypeScript gave, which this port has to match. */
final class Fixtures {

  private static final JsonNode ROOT = load();

  private Fixtures() {}

  private static JsonNode load() {
    try (InputStream in = Fixtures.class.getClassLoader()
        .getResourceAsStream("fixtures.json")) {
      if (in == null) {
        throw new IllegalStateException(
            "fixtures.json missing -- run `npm run export:fixtures` in phaser/");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("fixtures unreadable", e);
    }
  }

  static JsonNode of(String name) {
    JsonNode node = ROOT.get(name);
    if (node == null) throw new IllegalStateException("no fixture called " + name);
    return node;
  }
}
