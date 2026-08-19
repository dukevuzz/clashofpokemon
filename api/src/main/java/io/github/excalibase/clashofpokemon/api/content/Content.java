package io.github.excalibase.clashofpokemon.api.content;

import java.util.List;

/** The roster, exactly as the game exports it. */
public record Content(
    String version,
    List<Card> cards,
    List<Troop> troops,
    List<String> branches,
    Rules rules,
    List<String> wireCards) {

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
}
