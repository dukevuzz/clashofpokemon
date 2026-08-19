package io.github.excalibase.clashofpokemon.game.net;

import java.util.ArrayList;
import java.util.List;

/** What crosses the wire, named once. */
public final class Protocol {

  public static final int VERSION = 1;

  /** Simulation rate. Not negotiable -- the balance numbers assume it. */
  public static final int TICK_HZ = 30;

  /** Snapshot rate. */
  public static final int SNAP_HZ = 15;
  public static final int TICKS_PER_SNAP = TICK_HZ / SNAP_HZ;

  /** Action codes, so the renderer's four states survive as one number. */
  public static final List<String> ACTIONS = List.of("Walk", "Idle", "Attack", "Shoot");

  /** Status kinds as bits, in a fixed order both ends agree on. */
  public static final List<String> STATUS_BITS =
      List.of("paralysis", "flinch", "confusion", "armorBreak", "burn", "poison", "sleep");

  /** The alphabet an invite code is drawn from. */
  public static final String INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  public static final int INVITE_LENGTH = 5;

  private Protocol() {}

  public static int actionCode(String action) {
    int i = ACTIONS.indexOf(action);
    return i < 0 ? 1 : i;   // anything unrecognised stands still
  }

  /** Both ends encode a status set the same way, or statuses render as noise. */
  public static int statusBits(List<String> kinds) {
    int bits = 0;
    for (String k : kinds) {
      int i = STATUS_BITS.indexOf(k);
      if (i >= 0) bits |= 1 << i;
    }
    return bits;
  }

  public static List<String> bitsToStatus(int bits) {
    List<String> out = new ArrayList<>();
    for (int i = 0; i < STATUS_BITS.size(); i++) {
      if ((bits & (1 << i)) != 0) out.add(STATUS_BITS.get(i));
    }
    return out;
  }

  /** Why an intent was refused. The client shows a different message for each. */
  public enum Reject {
    ELIXIR, SLOT, ZONE, STALE, RATE, OVER, NOTSTARTED;

    /** Lower case on the wire, as the TypeScript union spells them. */
    public String wire() {
      return name().toLowerCase(java.util.Locale.ROOT);
    }
  }
}
