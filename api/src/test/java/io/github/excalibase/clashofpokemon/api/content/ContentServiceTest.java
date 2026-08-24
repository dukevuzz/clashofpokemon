package io.github.excalibase.clashofpokemon.api.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The roster, as the API sees it. */
class ContentServiceTest {

  static ContentService content;

  @BeforeAll
  static void load() {
    content = new ContentService();
  }

  @Test
  void loadsTheWholeRoster() {
    assertThat(content.cards()).hasSize(151);
    assertThat(content.troops()).hasSize(4);
  }

  @Test
  void knowsWhichCardsAreReal() {
    assertThat(content.isKnownCard("charmander")).isTrue();
    assertThat(content.isKnownCard("snorlax")).isTrue();
    assertThat(content.isKnownCard("not-a-pokemon")).isFalse();
    // An evolution is a real card, but not one you may put in a deck: it is
    // reached by playing, never chosen. Deck validation has to say no.
    assertThat(content.isKnownCard("charmeleon")).isFalse();
  }

  @Test
  void knowsWhichTroopsAreReal() {
    assertThat(content.isKnownTroop("togekiss")).isTrue();
    assertThat(content.isKnownTroop("mewtwo")).isFalse();
  }

  @Test
  void knowsEeveesBranches() {
    // A pre-committed branch is validated against this, so a stale one from an
    // old client cannot be stored against an account.
    assertThat(content.isKnownBranch("vaporeon")).isTrue();
    assertThat(content.isKnownBranch("charmander")).isFalse();
  }

  @Test
  void carriesTheRulesTheClientAlsoUses() {
    assertThat(content.rules().deckSize()).isEqualTo(6);
    assertThat(content.rules().handSize()).isEqualTo(4);
    assertThat(content.rules().matchSeconds()).isEqualTo(180);
  }

  @Test
  void hasAVersionThatIdentifiesTheContent() {
    assertThat(content.version()).isNotBlank();
    // Stable across reads: the handshake compares it, so it cannot be a value
    // that changes for reasons unrelated to the roster.
    assertThat(new ContentService().version()).isEqualTo(content.version());
  }

  @Test
  void refusesToStartWithoutContent() {
    // Better to fail at boot than to serve an empty roster and reject every
    // deck a player owns.
    assertThatThrownBy(() -> new ContentService("no-such-file.json"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("no-such-file.json");
  }

  @Test
  void cardsCarryWhatTheDeckScreenDraws() {
    var charmander = content.card("charmander").orElseThrow();
    assertThat(charmander.name()).isEqualTo("Charmander");
    assertThat(charmander.elixir()).isPositive();
    assertThat(charmander.types()).isNotEmpty();
  }
}
