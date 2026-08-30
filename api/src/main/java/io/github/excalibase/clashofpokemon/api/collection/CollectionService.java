package io.github.excalibase.clashofpokemon.api.collection;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a player owns, and what they can spend.
 *
 * Every spend here is a conditional UPDATE rather than a read-then-write. Two
 * requests arriving together -- a double-tapped button, a retried fetch -- must
 * not be able to open one chest twice or buy one face twice, and the way to
 * guarantee that is to let the database decide, not to check first and hope.
 * `where packs > 0` returning zero rows IS the refusal.
 */
@Service
public class CollectionService {

  private final JdbcClient db;
  private final PackRoller roller;

  CollectionService(JdbcClient db, ContentService content) {
    this.db = db;
    this.roller = new PackRoller(content.packs(), content.cards());
  }

  /** Everything the collection screen needs, in one round trip. */
  public State state(String accountId) {
    List<String> variants = db
        .sql("select variant from collection where account_id = ?")
        .param(accountId).query(String.class).list();

    Map<String, Integer> shards = new LinkedHashMap<>();
    db.sql("select card_id, amount from shard where account_id = ? and amount > 0")
        .param(accountId)
        .query((rs, n) -> Map.entry(rs.getString(1), rs.getInt(2)))
        .list().forEach(e -> shards.put(e.getKey(), e.getValue()));

    return db.sql("select coins, packs, matches_since_pack from account where id = ?")
        .param(accountId)
        .query((rs, n) -> new State(
            variants, shards, rs.getInt(1), rs.getInt(2), rs.getInt(3)))
        .single();
  }

  /**
   * Open one chest.
   *
   * The roll happens here rather than in the browser, which is the whole point
   * of the table existing: a pack decided client-side against `Math.random()`
   * is a pack the player writes. Returns null when there was no chest to open,
   * so the caller cannot conjure one by asking twice.
   */
  @Transactional
  public Opened open(String accountId) {
    int spent = db.sql("update account set packs = packs - 1 where id = ? and packs > 0")
        .param(accountId).update();
    if (spent == 0) return null;

    Set<String> owned = Set.copyOf(db
        .sql("select variant from collection where account_id = ?")
        .param(accountId).query(String.class).list());

    List<PackRoller.Pull> pulled = roller.open(ThreadLocalRandom.current());
    List<PackRoller.Pull> fresh = new ArrayList<>();
    List<PackRoller.Pull> repeats = new ArrayList<>();
    Set<String> seen = new java.util.HashSet<>(owned);

    for (PackRoller.Pull p : pulled) {
      if (seen.add(p.variant())) fresh.add(p); else repeats.add(p);
    }

    for (PackRoller.Pull p : fresh) {
      db.sql("insert into collection (account_id, variant) values (?, ?) "
             + "on conflict do nothing")
          .params(accountId, p.variant()).update();
    }

    Map<String, Integer> earned = new LinkedHashMap<>();
    for (PackRoller.Pull p : repeats) {
      earned.merge(p.cardId(), roller.shardsFor(p), Integer::sum);
    }
    earned.forEach((cardId, amount) -> db
        .sql("insert into shard (account_id, card_id, amount) values (?, ?, ?) "
             + "on conflict (account_id, card_id) do update set amount = shard.amount + ?")
        .params(accountId, cardId, amount, amount).update());

    return new Opened(pulled, fresh.stream().map(PackRoller.Pull::variant).toList(), earned);
  }

  /** Trade shards for one face. False when unaffordable or already held; nothing moves. */
  @Transactional
  public boolean buyFace(String accountId, String cardId, int emotion, boolean shiny) {
    String face = emotion == 0 ? "" : "#e" + emotion;
    String variant = cardId + face + (shiny ? "#shiny" : "");

    Integer already = db
        .sql("select 1 from collection where account_id = ? and variant = ?")
        .params(accountId, variant).query(Integer.class).optional().orElse(null);
    if (already != null) return false;

    int cost = roller.faceCost(emotion, shiny);
    // The check constraint on `amount` would reject a negative anyway; this
    // says so in the predicate too, so the refusal is a zero-row update rather
    // than an exception the caller has to interpret.
    int paid = db.sql("update shard set amount = amount - ? "
                      + "where account_id = ? and card_id = ? and amount >= ?")
        .params(cost, accountId, cardId, cost).update();
    if (paid == 0) return false;

    db.sql("insert into collection (account_id, variant) values (?, ?) on conflict do nothing")
        .params(accountId, variant).update();
    return true;
  }

  /** Trade coins for a chest. False when there are not enough, and nothing moves. */
  @Transactional
  public boolean buyPack(String accountId, int price) {
    return db.sql("update account set coins = coins - ?, packs = packs + 1 "
                  + "where id = ? and coins >= ?")
        .params(price, accountId, price).update() > 0;
  }

  /**
   * Pay for a finished match.
   *
   * `matches_since_pack` rolls over rather than resetting: a player who earns a
   * chest on match five starts match six one closer to the next, not back at
   * the beginning.
   */
  @Transactional
  public Reward reward(String accountId, int coins, int matchesPerPack) {
    db.sql("update account set coins = coins + ?, matches_since_pack = matches_since_pack + 1 "
           + "where id = ?").params(coins, accountId).update();

    boolean earned = db
        .sql("update account set packs = packs + 1, matches_since_pack = matches_since_pack - ? "
             + "where id = ? and matches_since_pack >= ?")
        .params(matchesPerPack, accountId, matchesPerPack).update() > 0;

    int since = db.sql("select matches_since_pack from account where id = ?")
        .param(accountId).query(Integer.class).single();
    return new Reward(coins, earned, matchesPerPack - since);
  }

  public record State(
      List<String> variants, Map<String, Integer> shards,
      int coins, int packs, int matchesSincePack) {}

  public record Opened(
      List<PackRoller.Pull> pulled, List<String> fresh, Map<String, Integer> shards) {}

  public record Reward(int coins, boolean pack, int toNextPack) {}
}
