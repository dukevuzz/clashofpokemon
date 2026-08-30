package io.github.excalibase.clashofpokemon.api;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.api.auth.GuestService;
import io.github.excalibase.clashofpokemon.api.collection.CollectionService;
import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * The collection, now that the server owns it.
 *
 * The tests that matter here are the refusals. A chest opened twice, a face
 * bought twice, a spend that outruns the balance -- those are what a client
 * can attempt for free, and the server is the only thing standing in the way.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class CollectionTest {

  @Autowired CollectionService collection;
  @Autowired ContentService content;
  @Autowired GuestService guests;
  @Autowired JdbcClient db;

  private String someone() {
    return guests.create().account().id();
  }

  private void giveChests(String account, int n) {
    db.sql("update account set packs = ? where id = ?").params(n, account).update();
  }

  @Test
  void anEmptyAccountOwnsNothing() {
    var state = collection.state(someone());
    assertThat(state.variants()).isEmpty();
    assertThat(state.shards()).isEmpty();
    assertThat(state.coins()).isZero();
    assertThat(state.packs()).isZero();
  }

  @Test
  void openingWithoutAChestGivesNothing() {
    assertThat(collection.open(someone())).isNull();
  }

  @Test
  void aChestIsSpentExactlyOnce() {
    String who = someone();
    giveChests(who, 1);

    assertThat(collection.open(who)).isNotNull();
    // The second call is the one that matters: a double-tapped button, a
    // retried request. The chest is gone and must stay gone.
    assertThat(collection.open(who)).isNull();
    assertThat(collection.state(who).packs()).isZero();
  }

  @Test
  void aChestGivesSixDistinctVariantsAndKeepsThem() {
    String who = someone();
    giveChests(who, 1);

    var opened = collection.open(who);
    assertThat(opened).isNotNull();
    assertThat(opened.pulled()).hasSize(content.packs().size());
    // Without replacement: no card appears twice in one chest.
    assertThat(opened.pulled().stream().map(p -> p.cardId()).distinct().count())
        .isEqualTo(content.packs().size());

    var state = collection.state(who);
    assertThat(state.variants()).containsExactlyInAnyOrderElementsOf(
        Set.copyOf(opened.fresh()));
  }

  @Test
  void theLastCardIsAlwaysWorthEndingOn() {
    String who = someone();
    // One chest could be luck; the guarantee has to hold every time.
    for (int i = 0; i < 25; i++) {
      giveChests(who, 1);
      var opened = collection.open(who);
      assertThat(opened).isNotNull();
      var last = opened.pulled().get(opened.pulled().size() - 1);
      assertThat(content.packs().headlineRarities()).contains(last.rarity());
    }
  }

  @Test
  void repeatsPayShardsForTheCreatureTheyRepeated() {
    String who = someone();
    // Enough chests that repeats are certain across 151 cards.
    giveChests(who, 40);
    for (int i = 0; i < 40; i++) collection.open(who);

    var state = collection.state(who);
    assertThat(state.shards()).isNotEmpty();
    // Shards are per creature, and every creature paid for is one we own.
    state.shards().keySet().forEach(cardId ->
        assertThat(content.isKnownCard(cardId)).isTrue());
    assertThat(state.shards().values()).allSatisfy(n -> assertThat(n).isPositive());
  }

  @Test
  void aFaceCannotBeBoughtWithoutTheShards() {
    String who = someone();
    assertThat(collection.buyFace(who, "charmander", 1, false)).isFalse();
    assertThat(collection.state(who).variants()).isEmpty();
  }

  @Test
  void aFaceIsBoughtOnceAndPaidForOnce() {
    String who = someone();
    int cost = content.packs().emotionCost().get(1);
    db.sql("insert into shard (account_id, card_id, amount) values (?, ?, ?)")
        .params(who, "charmander", cost).update();

    assertThat(collection.buyFace(who, "charmander", 1, false)).isTrue();
    assertThat(collection.state(who).shards().getOrDefault("charmander", 0)).isZero();
    assertThat(collection.state(who).variants()).contains("charmander#e1");

    // Already owned, and the balance is empty anyway -- either alone must refuse.
    assertThat(collection.buyFace(who, "charmander", 1, false)).isFalse();
  }

  @Test
  void aShinyFaceCostsTripleAndIsItsOwnThingToOwn() {
    String who = someone();
    int plain = content.packs().emotionCost().get(1);
    db.sql("insert into shard (account_id, card_id, amount) values (?, ?, ?)")
        .params(who, "charmander", plain * 3).update();

    // The plain face at this price would leave change; the shiny takes it all.
    assertThat(collection.buyFace(who, "charmander", 1, true)).isTrue();
    assertThat(collection.state(who).variants()).contains("charmander#e1#shiny");
    // Owning the shiny is not owning the plain one.
    assertThat(collection.state(who).variants()).doesNotContain("charmander#e1");
  }

  @Test
  void aChestCannotBeBoughtWithoutTheCoins() {
    String who = someone();
    int price = content.packs().packPrice();
    assertThat(collection.buyPack(who, price)).isFalse();

    db.sql("update account set coins = ? where id = ?").params(price, who).update();
    assertThat(collection.buyPack(who, price)).isTrue();
    assertThat(collection.state(who).coins()).isZero();
    assertThat(collection.state(who).packs()).isEqualTo(1);
    // The coins are gone, so a second attempt must fail.
    assertThat(collection.buyPack(who, price)).isFalse();
  }

  @Test
  void matchesRollOverTowardTheNextFreeChest() {
    String who = someone();
    int per = content.packs().matchesPerPack();

    for (int i = 1; i < per; i++) {
      var r = collection.reward(who, 12, per);
      assertThat(r.pack()).isFalse();
      assertThat(r.toNextPack()).isEqualTo(per - i);
    }
    // The one that earns it, and the counter rolls over rather than resetting.
    var earned = collection.reward(who, 12, per);
    assertThat(earned.pack()).isTrue();
    assertThat(collection.state(who).packs()).isEqualTo(1);
    assertThat(collection.state(who).matchesSincePack()).isZero();
  }
}
