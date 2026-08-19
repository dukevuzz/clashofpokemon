package io.github.excalibase.clashofpokemon.game.rules;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** Applying, expiring and asking about afflictions. */
public final class Statuses {

  /** Burn and poison take this fraction of maximum health, this often. */
  public static final double DOT_FRACTION = 0.05;
  public static final double DOT_INTERVAL = 1.0;

  /** Broken armour is halved, not removed. */
  public static final double ARMOR_BREAK = 0.5;
  /** Paralysis leaves this much of a creature's speed. */
  public static final double PARALYSIS_SPEED = 0.4;

  /** What a move inflicts, and how often it lands. */
  public record Effect(StatusKind kind, double seconds, double chance) {}

  /** Move to status, from PAC's ability strategies. */
  public static final Map<String, Effect> MOVE_STATUS = Rules.moveStatuses();

  private Statuses() {}

  public static boolean has(List<Status> list, StatusKind kind) {
    if (list == null) return false;
    for (Status s : list) {
      if (s.kind == kind && s.left > 0) return true;
    }
    return false;
  }

  /** Frozen or asleep: either way, nothing happens. */
  public static boolean frozen(List<Status> list) {
    return has(list, StatusKind.FREEZE) || has(list, StatusKind.SLEEP);
  }

  public static void apply(List<Status> list, StatusKind kind, double seconds) {
    apply(list, kind, seconds, null);
  }

  public static void apply(List<Status> list, StatusKind kind, double seconds, Integer by) {
    for (Status existing : list) {
      if (existing.kind != kind) continue;
      // Extends, never stacks -- and a shorter one never cuts a longer short.
      existing.left = Math.max(existing.left, seconds);
      if (by != null) existing.by = by;
      return;
    }
    list.add(new Status(kind, seconds, by, DOT_INTERVAL));
  }

  /** Hit me and I stop sleeping, whatever put me under. */
  public static void wake(List<Status> list) {
    list.removeIf(s -> s.kind == StatusKind.SLEEP);
  }

  /** Count everything down, and drop what has run out. */
  public static boolean tick(List<Status> list, double dt) {
    boolean expired = false;
    Iterator<Status> it = list.iterator();
    while (it.hasNext()) {
      Status s = it.next();
      s.left -= dt;
      if (s.left <= 0) {
        it.remove();
        expired = true;
      }
    }
    return expired;
  }
}
