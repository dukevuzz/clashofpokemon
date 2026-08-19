package io.github.excalibase.clashofpokemon.api.deck;

/** One thing wrong with a deck, and where. */
public record DeckProblem(String field, String message) {}
