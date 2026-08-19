package io.github.excalibase.clashofpokemon.api.play;

/** The two kinds of match the server never sees played. */
public enum Mode {
  OFFLINE,
  TUTORIAL;

  public static Mode of(String raw) {
    return switch (raw == null ? "" : raw.trim().toLowerCase()) {
      case "offline" -> OFFLINE;
      case "tutorial" -> TUTORIAL;
      default -> throw new IllegalArgumentException("unknown mode: " + raw);
    };
  }

  public String wire() {
    return name().toLowerCase();
  }
}
