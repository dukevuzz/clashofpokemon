package io.github.excalibase.clashofpokemon.api.content;

import java.util.List;

/** The roster, exactly as the game exports it. */
public record Content(
    String version,
    List<Card> cards,
    List<Troop> troops,
    List<String> branches,
    Rules rules,
    List<String> wireCards,
    Packs packs) {

  /** A card a deck may contain. Not every card that can appear in a match. */
  public record Card(
      String id,
      String name,
      int elixir,
      String rarity,
      String role,
      List<String> types,
      String sheet) {}

  public record Troop(String id, String name, String blurb) {}

  /** Numbers the client and the validator must agree on. */
  public record Rules(int deckSize, int handSize, int elixirMax, int matchSeconds) {}

  /**
   * Everything needed to roll a chest, exported from the client's `core/packs.ts`.
   *
   * Exported rather than transcribed: two implementations of the same odds
   * drift apart the first time one of them is tuned and the other is not, and
   * the drift is invisible until a player notices their pulls do not match
   * what the game says. Change a weight there, re-run the export, and this
   * changes with it.
   */
  public record Packs(
      int size,
      java.util.Map<String, Integer> perCardWeight,
      List<String> headlineRarities,
      double shinyChance,
      List<Integer> emotionCost,
      /** What a chest costs in coins, and how many matches earn a free one. */
      int packPrice,
      int matchesPerPack,
      java.util.Map<String, Integer> coinsPer,
      int shardsPerDuplicate,
      int shardsPerShinyDuplicate,
      /** Sheets with shiny art. A roll must never produce a variant with no picture. */
      List<String> shinySheets,
      /** Per sheet, which faces exist: `n` normal, `s` shiny. Indices into emotionCost. */
      java.util.Map<String, Faces> faces) {

    public record Faces(List<Integer> n, List<Integer> s) {}
  }
}
