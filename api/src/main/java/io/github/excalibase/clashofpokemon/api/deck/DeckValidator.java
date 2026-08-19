package io.github.excalibase.clashofpokemon.api.deck;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Is this deck one the game could actually play? */
@Component
public class DeckValidator {

  private final ContentService content;

  public DeckValidator(ContentService content) {
    this.content = content;
  }

  public List<DeckProblem> check(List<String> cards, String troop, String branch) {
    List<DeckProblem> problems = new ArrayList<>();
    checkCards(cards, problems);
    checkTroop(troop, problems);
    checkBranch(branch, problems);
    return List.copyOf(problems);
  }

  private void checkCards(List<String> cards, List<DeckProblem> problems) {
    int required = content.rules().deckSize();
    if (cards == null || cards.size() != required) {
      problems.add(new DeckProblem("cards",
          "a deck holds exactly " + required + " cards, this one has "
              + (cards == null ? 0 : cards.size())));
      if (cards == null) return;
    }

    Set<String> seen = new HashSet<>();
    for (String id : cards) {
      if (!content.isKnownCard(id)) {
        // Covers both "no such card" and "a card you cannot choose": an
        // evolution is real and playable but is reached, never picked.
        problems.add(new DeckProblem("cards", "no such card to choose: " + id));
      } else if (!seen.add(id)) {
        problems.add(new DeckProblem("cards", "the same card twice: " + id));
      }
    }
  }

  private void checkTroop(String troop, List<DeckProblem> problems) {
    if (!content.isKnownTroop(troop)) {
      problems.add(new DeckProblem("troop", "no such tower creature: " + troop));
    }
  }

  private void checkBranch(String branch, List<DeckProblem> problems) {
    // Absent is the normal case: most players never pre-commit one.
    if (branch == null || branch.isBlank()) return;
    if (!content.isKnownBranch(branch)) {
      problems.add(new DeckProblem("branch", "Eevee does not become: " + branch));
    }
  }
}
