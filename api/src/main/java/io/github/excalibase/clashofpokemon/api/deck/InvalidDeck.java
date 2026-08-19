package io.github.excalibase.clashofpokemon.api.deck;

import java.util.List;

/** The deck was refused, and here is everything wrong with it. */
public class InvalidDeck extends RuntimeException {

  private final transient List<DeckProblem> problems;

  public InvalidDeck(List<DeckProblem> problems) {
    super("deck rejected: " + problems.size() + " problem(s)");
    this.problems = List.copyOf(problems);
  }

  public List<DeckProblem> problems() {
    return problems;
  }
}
