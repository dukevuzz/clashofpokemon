package io.github.excalibase.clashofpokemon.api.deck;

import io.github.excalibase.clashofpokemon.api.auth.NewAccountSetup;
import org.springframework.stereotype.Component;

/** Gives every new account a deck it can play with immediately. */
@Component
class StarterDeckSetup implements NewAccountSetup {

  private final DeckService decks;

  StarterDeckSetup(DeckService decks) {
    this.decks = decks;
  }

  @Override
  public void prepare(String accountId) {
    decks.seedStarter(accountId);
  }
}
