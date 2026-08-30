package io.github.excalibase.clashofpokemon.api.play;

/** How an offline match ended, from the player's side. */
public enum Result {
  WIN, LOSS, DRAW;

  /** Absent and unrecognised both mean "do not count it", never an error. */
  public static Result of(String raw) {
    if (raw == null) return null;
    for (Result r : values()) {
      if (r.name().equalsIgnoreCase(raw)) return r;
    }
    return null;
  }

  public String wire() {
    return name().toLowerCase(java.util.Locale.ROOT);
  }
}
