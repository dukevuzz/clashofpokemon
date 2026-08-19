package io.github.excalibase.clashofpokemon.api.deck;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import io.github.excalibase.clashofpokemon.api.auth.GuestService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/** Decks that survive a new phone. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class DeckServiceTest {

  @Autowired DeckService decks;
  @Autowired GuestService guests;

  private String someone() {
    return guests.create().account().id();
  }

  @Test
  void aNewAccountCanPlayImmediately() {
    // A guest who has to build a deck before their first match is a guest who
    // leaves. The starter deck is seeded when the account is created.
    var deck = decks.get(someone(), 0).orElseThrow();
    assertThat(deck.cards()).hasSize(6);
    assertThat(deck.troop()).isNotBlank();
  }

  @Test
  void aSavedDeckComesBack() {
    String id = someone();
    var saved = List.of("charmander", "snorlax", "voltorb", "machop", "geodude", "eevee");
    decks.save(id, 0, saved, "crobat", "vaporeon");

    var back = decks.get(id, 0).orElseThrow();
    assertThat(back.cards()).containsExactlyElementsOf(saved);
    assertThat(back.troop()).isEqualTo("crobat");
    assertThat(back.branch()).isEqualTo("vaporeon");
  }

  @Test
  void savingTwiceReplacesRatherThanDuplicates() {
    String id = someone();
    var first = List.of("charmander", "snorlax", "voltorb", "machop", "geodude", "eevee");
    var second = List.of("pikachu", "snorlax", "voltorb", "machop", "geodude", "eevee");
    decks.save(id, 0, first, "togekiss", null);
    decks.save(id, 0, second, "togekiss", null);

    assertThat(decks.get(id, 0).orElseThrow().cards()).containsExactlyElementsOf(second);
    assertThat(decks.all(id)).hasSize(1);
  }

  @Test
  void aSecondLoadoutIsASecondSlot() {
    String id = someone();
    decks.save(id, 0, List.of("charmander", "snorlax", "voltorb", "machop", "geodude", "eevee"),
        "togekiss", null);
    decks.save(id, 1, List.of("pikachu", "snorlax", "voltorb", "machop", "geodude", "eevee"),
        "crobat", null);

    assertThat(decks.all(id)).hasSize(2);
    assertThat(decks.get(id, 1).orElseThrow().troop()).isEqualTo("crobat");
  }

  @Test
  void anIllegalDeckIsRefusedAndNothingIsStored() {
    String id = someone();
    var before = decks.get(id, 0).orElseThrow().cards();

    assertThatThrownBy(() -> decks.save(id, 0,
        List.of("charmander", "not-a-pokemon", "voltorb", "machop", "geodude", "eevee"),
        "togekiss", null))
        .isInstanceOf(InvalidDeck.class)
        .satisfies(e -> assertThat(((InvalidDeck) e).problems())
            .anySatisfy(p -> assertThat(p.message()).contains("not-a-pokemon")));

    // The old deck is untouched -- a rejected save must not empty a hand.
    assertThat(decks.get(id, 0).orElseThrow().cards()).containsExactlyElementsOf(before);
  }

  @Test
  void oneAccountCannotReadAnother() {
    String mine = someone();
    String theirs = someone();
    decks.save(theirs, 0, List.of("pikachu", "snorlax", "voltorb", "machop", "geodude", "eevee"),
        "crobat", null);

    assertThat(decks.get(mine, 0).orElseThrow().cards())
        .isNotEqualTo(decks.get(theirs, 0).orElseThrow().cards());
  }

  @Test
  void anEmptySlotIsEmptyRatherThanAnError() {
    assertThat(decks.get(someone(), 7)).isEmpty();
  }
}
