package io.github.excalibase.clashofpokemon.game.rules;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Where exactly do the two engines part company?
 *
 * The differential suite compares blows, which says *that* they disagree and
 * never *where* it began -- by the time a blow differs the cause is thousands
 * of frames upstream. This replays one match against a per-step fingerprint of
 * every unit's exact position and reports the first step that differs, so the
 * cause can be read off instead of guessed at. Three guesses were wrong before
 * this existed.
 */
class TraceTest {

  static RandomGenerator mulberry32(int seed) {
    return DifferentialTest.mulberry32(seed);
  }

  @Test
  void findsTheFirstStepThatDiffers() throws Exception {
    ObjectMapper json = new ObjectMapper();
    JsonNode trace;
    try (InputStream in = getClass().getResourceAsStream("/trace.json")) {
      if (in == null) { System.out.println("no trace.json; skipping"); return; }
      trace = json.readTree(in);
    }
    JsonNode fixture;
    try (InputStream in = getClass().getResourceAsStream("/differential.json")) {
      fixture = json.readTree(in).get("matches").get(trace.get("index").intValue());
    }

    Match.Options opts = new Match.Options();
    opts.rng = mulberry32(fixture.get("seed").intValue());
    opts.deckOne = deckOf(fixture.get("deckOne"));
    opts.deckTwo = deckOf(fixture.get("deckTwo"));
    opts.shuffle = false;
    opts.bot = java.util.Map.of();
    Match match = new Match(opts);

    JsonNode plays = fixture.get("plays");
    JsonNode steps = trace.get("steps");
    int next = 0;

    for (int step = 0; step < steps.size() && match.over == null; step++) {
      while (next < plays.size() && plays.get(next).get("step").intValue() == step) {
        JsonNode p = plays.get(next++);
        Side side = p.get("side").intValue() == 1 ? Side.ONE : Side.TWO;
        match.deploy(side, p.get("slot").intValue(),
            p.get("x").doubleValue(), p.get("y").doubleValue());
      }
      match.update(1.0 / 30.0);

      StringBuilder towers = new StringBuilder();
      for (Tower t : match.towers) {
        if (towers.length() > 0) towers.append('|');
        towers.append(t.id).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(t.hp))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(t.cooldown))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(t.reloading))).append(':')
            .append(t.ammo).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(t.waking))).append(':')
            .append(t.active ? 1 : 0).append(':')
            .append(t.dead ? 1 : 0);
      }
      StringBuilder shots = new StringBuilder();
      for (Projectile p : match.projectiles) {
        if (shots.length() > 0) shots.append('|');
        shots.append(Long.toHexString(Double.doubleToRawLongBits(p.x))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(p.y))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(p.amount))).append(':')
            .append(p.target instanceof Tower t2 ? t2.id : ((Unit) p.target).id);
      }

      StringBuilder units = new StringBuilder();
      for (Unit u : match.units) {
        if (units.length() > 0) units.append('|');
        String tgt = u.target == null ? "-"
            : (u.target instanceof Tower t ? "T" + t.id : "U" + ((Unit) u.target).id);
        units.append(u.id).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(u.x))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(u.y))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(u.hp))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(u.cooldown))).append(':')
            .append(tgt).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(u.charge))).append(':')
            .append(Long.toHexString(Double.doubleToRawLongBits(u.spawning))).append(':')
            .append(u.dead ? 1 : 0);
      }
      String mine = towers + "#" + shots + "#" + units;
      String theirs = steps.get(step).stringValue();
      if (!mine.equals(theirs)) {
        System.out.println("FIRST DIVERGENCE step " + step + " (t=" + (step / 30.0) + "s)");
        System.out.println("  ts   " + theirs);
        System.out.println("  java " + mine);
        return;
      }
    }
    System.out.println("no divergence in " + steps.size() + " steps");
  }

  private static List<Card> deckOf(JsonNode ids) {
    List<Card> deck = new ArrayList<>();
    for (JsonNode id : ids) deck.add(Cards.byId(id.stringValue()));
    return deck;
  }
}
