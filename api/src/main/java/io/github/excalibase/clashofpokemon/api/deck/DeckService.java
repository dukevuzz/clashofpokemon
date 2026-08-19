package io.github.excalibase.clashofpokemon.api.deck;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reading and writing a player's decks, refusing anything unplayable. */
@Service
public class DeckService {

  private final DeckRepository repository;
  private final DeckValidator validator;
  private final ContentService content;

  DeckService(DeckRepository repository, DeckValidator validator, ContentService content) {
    this.repository = repository;
    this.validator = validator;
    this.content = content;
  }

  public Optional<Deck> get(String accountId, int slot) {
    return repository.find(accountId, slot);
  }

  public List<Deck> all(String accountId) {
    return repository.all(accountId);
  }

  /** Validate first, then store. A refused save leaves the old deck alone. */
  @Transactional
  public void save(String accountId, int slot, List<String> cards, String troop, String branch) {
    var problems = validator.check(cards, troop, branch);
    if (!problems.isEmpty()) throw new InvalidDeck(problems);
    repository.save(accountId, new Deck(slot, null, cards, troop, branch));
  }

  /** What a brand new account gets. */
  @Transactional
  public void seedStarter(String accountId) {
    List<String> starter = content.cards().stream()
        .sorted(java.util.Comparator.comparingInt(c -> c.elixir()))
        .limit(content.rules().deckSize())
        .map(c -> c.id())
        .toList();
    repository.save(accountId, new Deck(0, "Starter", starter,
        content.troops().getFirst().id(), null));
  }
}
