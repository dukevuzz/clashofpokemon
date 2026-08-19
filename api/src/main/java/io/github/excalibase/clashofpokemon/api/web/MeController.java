package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.auth.AccountRepository;
import io.github.excalibase.clashofpokemon.api.deck.DeckService;
import io.github.excalibase.clashofpokemon.api.match.MatchResultService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** The player, their deck, and what they have played. */
@RestController
class MeController {

  private final CurrentAccount current;
  private final AccountRepository accounts;
  private final DeckService decks;
  private final MatchResultService matches;

  MeController(CurrentAccount current, AccountRepository accounts,
      DeckService decks, MatchResultService matches) {
    this.current = current;
    this.accounts = accounts;
    this.decks = decks;
    this.matches = matches;
  }

  /** Everything the menu draws, in one call. */
  @GetMapping("/v1/me")
  Map<String, Object> me(HttpServletRequest request) {
    String id = current.require(request);
    var account = accounts.find(id).orElseThrow();
    accounts.touch(id);

    var body = new HashMap<String, Object>();
    body.put("account", account);
    decks.get(id, 0).ifPresent(deck -> body.put("deck", deck));
    return body;
  }

  @GetMapping("/v1/me/deck")
  Object deck(HttpServletRequest request) {
    return decks.get(current.require(request), 0).orElse(null);
  }

  @PutMapping("/v1/me/deck")
  void saveDeck(HttpServletRequest request, @RequestBody DeckBody body) {
    decks.save(current.require(request), body.slotOrFirst(),
        body.cards(), body.troop(), body.branch());
  }

  /** What an opponent may see: a name and a record, never a deck. */
  @GetMapping("/v1/users/{id}")
  Map<String, Object> publicProfile(@PathVariable String id) {
    var account = accounts.find(id).orElseThrow();
    return Map.of(
        "id", account.id(), "displayName", account.displayName(),
        "wins", account.wins(), "losses", account.losses(), "draws", account.draws());
  }

  @GetMapping("/v1/me/matches")
  List<?> history(HttpServletRequest request) {
    return matches.historyFor(current.require(request));
  }

  /** Slot defaults to 0, so a client with one loadout need not send it. */
  record DeckBody(Integer slot, List<String> cards, String troop, String branch) {
    int slotOrFirst() {
      return slot == null ? 0 : slot;
    }
  }
}
