package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.auth.Account;
import io.github.excalibase.clashofpokemon.api.auth.AccountRepository;
import io.github.excalibase.clashofpokemon.api.auth.ProfileService;
import io.github.excalibase.clashofpokemon.api.deck.DeckService;
import io.github.excalibase.clashofpokemon.api.match.MatchResultService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
  private final ProfileService profiles;

  MeController(CurrentAccount current, AccountRepository accounts,
      DeckService decks, MatchResultService matches, ProfileService profiles) {
    this.current = current;
    this.accounts = accounts;
    this.decks = decks;
    this.matches = matches;
    this.profiles = profiles;
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

  /**
   * Change the name, the face, or both.
   *
   * A field left out is left alone, so the name box and the avatar picker can
   * save independently without either one clobbering the other's value. An
   * empty avatar is a deliberate "no face", not an omission.
   */
  @PatchMapping("/v1/me")
  Account edit(HttpServletRequest request, @RequestBody ProfileBody body) {
    return profiles.update(current.require(request), body.displayName(), body.avatar());
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
    var body = new HashMap<String, Object>();
    body.put("id", account.id());
    body.put("displayName", account.displayName());
    // Null until they pick one, and Map.of refuses null values.
    body.put("avatar", account.avatar());
    body.put("wins", account.wins());
    body.put("losses", account.losses());
    body.put("draws", account.draws());
    return body;
  }

  @GetMapping("/v1/me/matches")
  List<?> history(HttpServletRequest request) {
    return matches.historyFor(current.require(request));
  }

  record ProfileBody(String displayName, String avatar) {}

  /** Slot defaults to 0, so a client with one loadout need not send it. */
  record DeckBody(Integer slot, List<String> cards, String troop, String branch) {
    int slotOrFirst() {
      return slot == null ? 0 : slot;
    }
  }
}
