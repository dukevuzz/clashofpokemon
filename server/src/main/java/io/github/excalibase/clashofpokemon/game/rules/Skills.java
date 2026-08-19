package io.github.excalibase.clashofpokemon.game.rules;

import java.util.List;
import java.util.Map;

/** What a cast does, when it is not simply damage. */
public final class Skills {

  /** A shield is worth more than its face value: the number is small. */
  private static final double SHIELD_SCALE = Rules.skillDouble("shieldScale");
  /** How near a cast reaches, for splash and for finding allies. */
  public static final double RADIUS = Rules.skillDouble("radius");

  public record Effect(String kind, double amount, String stat) {}

  public record Powered(String from, List<Double> scale, List<Double> boostDef) {}

  private static final Map<String, Effect> MOVE_EFFECT = Rules.moveEffects();
  private static final Map<String, Powered> POWERED = Rules.poweredMoves();

  private Skills() {}

  public static Effect effectFor(String skill) {
    return skill == null ? null : MOVE_EFFECT.get(skill);
  }

  /** Damage a powered move reads off whoever is casting it. */
  public static Double poweredDamage(String move, Unit caster, Unit target) {
    Powered p = move == null ? null : POWERED.get(move);
    if (p == null) return null;

    int stage = Math.max(1, Math.min(4, caster.card == null ? 1 : caster.card.stage()));
    double scale = at(p.scale(), stage);
    if (p.boostDef() != null && !p.boostDef().isEmpty()) {
      caster.def += (int) at(p.boostDef(), stage);
    }

    return switch (p.from()) {
      case "def" -> caster.def * scale;
      case "maxHP" -> caster.maxHP * scale;
      case "attack" -> caster.damage * scale;
      case "targetAttack" -> (target != null ? target.damage : caster.damage) * scale;
      default -> null;
    };
  }

  private static double at(List<Double> values, int stage) {
    return values.get(Math.min(stage - 1, values.size() - 1));
  }

  /** Apply a non-damaging cast. */
  public static boolean applyEffect(
      Match match, List<Tower> towers, Unit u, List<Unit> allies, Effect effect) {
    if (effect == null) return false;

    switch (effect.kind()) {
      case "elixir" -> {
        match.elixir.merge(u.side, effect.amount(),
            (a, b) -> Math.min(Rules.config().elixirMax(), a + b));
        return true;
      }
      case "shield" -> {
        // On the toughest ally rather than the caster: a shield is worth most
        // on whatever is already soaking the damage.
        Unit best = null;
        for (Unit o : allies) {
          if (o == u) continue;
          if (best == null || o.maxHP > best.maxHP) best = o;
        }
        Unit on = best != null ? best : u;
        on.shield += (int) Math.round(effect.amount() * SHIELD_SCALE);
        return true;
      }
      case "heal" -> {
        double amount = u.maxHP * effect.amount();
        for (Unit o : allies) o.hp = (int) Math.min(o.maxHP, o.hp + amount);
        return true;
      }
      case "buff" -> {
        switch (effect.stat()) {
          case "speed" -> u.speed *= effect.amount();
          case "def" -> u.def = (int) (u.def * effect.amount() + 2);
          default -> u.speDef = (int) (u.speDef * effect.amount() + 2);
        }
        return true;
      }
      default -> {
        // Blink: forward, and never into stonework.
        double to = u.y + effect.amount() * Board.forwardFor(u.side);
        u.y = Math.min(Math.max(to, 8), Rules.config().arenaHeight() - 8);
        Movement.pushOutOfTowers(towers, u);
        return true;
      }
    }
  }
}
