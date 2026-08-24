package io.github.excalibase.clashofpokemon.game.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The deck a seed deals, when nobody brought one.
 *
 * Both engines sampled the same pool with the same generator and got different
 * decks. TypeScript shuffles the whole pool and takes the first six; Java used
 * to pull six out of the middle one at a time. Both are fair, and they consume
 * the generator differently -- seed 9 dealt hoppip on one side and ditto on
 * the other.
 *
 * No differential match caught it, because every one of them hands both
 * engines an explicit deck. This path is walked by bots and by tests, which is
 * exactly the sort of place a divergence hides.
 */
class DealtDeckTest {

  private static final JsonNode ROOT = read();

  private static JsonNode read() {
    try (InputStream in = DealtDeckTest.class.getClassLoader()
        .getResourceAsStream("fixtures.json")) {
      if (in == null) {
        throw new IllegalStateException(
            "fixtures.json missing -- run `npm run export:fixtures` in client/");
      }
      return new ObjectMapper().readTree(in);
    } catch (Exception e) {
      throw new IllegalStateException("cannot read fixtures.json", e);
    }
  }

  /** The generator both engines run. Ported verbatim; see MulberryTest. */
  private static RandomGenerator mulberry(long seed) {
    return new RandomGenerator() {
      private int state = (int) seed;

      @Override
      public long nextLong() {
        return (long) (nextDouble() * Long.MAX_VALUE);
      }

      @Override
      public double nextDouble() {
        state = state + 0x6d2b79f5;
        int t = state;
        t = (t ^ (t >>> 15)) * (1 | t);
        t = t + ((t ^ (t >>> 7)) * (61 | t)) ^ t;
        return ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
      }
    };
  }

  @Test
  void everySeedDealsTheSameDeckInBothEngines() {
    List<String> wrong = new ArrayList<>();
    int checked = 0;

    for (JsonNode row : ROOT.get("decks")) {
      long seed = row.get("seed").asLong();
      List<String> expected = new ArrayList<>();
      for (JsonNode id : row.get("cards")) {
        expected.add(id.asString());
      }

      List<String> actual = Cards.newDeck(mulberry(seed)).stream().map(Card::id).toList();
      checked++;
      if (!expected.equals(actual)) {
        wrong.add("seed " + seed + ": expected " + expected + ", got " + actual);
      }
    }

    assertThat(checked).isEqualTo(24);
    // Order matters as much as membership: slot one is the Mega slot, so a
    // deck with the same six cards in a different order is a different deck.
    assertThat(wrong).isEmpty();
  }
}
