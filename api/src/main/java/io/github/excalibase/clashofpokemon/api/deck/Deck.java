package io.github.excalibase.clashofpokemon.api.deck;

import java.util.List;

/** A saved loadout. `slot` leaves room for more than one without a migration. */
public record Deck(int slot, String name, List<String> cards, String troop, String branch) {}
