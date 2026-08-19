package io.github.excalibase.clashofpokemon.api.deck;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Storing decks. One row per (account, slot); nothing here decides anything. */
@Repository
public class DeckRepository {

  private final JdbcClient db;

  DeckRepository(JdbcClient db) {
    this.db = db;
  }

  public Optional<Deck> find(String accountId, int slot) {
    return db.sql("""
        select slot, name, cards, troop, branch
        from deck where account_id = ? and slot = ?
        """).params(accountId, slot).query(this::map).optional();
  }

  public List<Deck> all(String accountId) {
    return db.sql("""
        select slot, name, cards, troop, branch
        from deck where account_id = ? order by slot
        """).param(accountId).query(this::map).list();
  }

  /** Upsert, so saving is idempotent from the client's point of view. */
  public void save(String accountId, Deck deck) {
    db.sql("""
        insert into deck (account_id, slot, name, cards, troop, branch, updated_at)
        values (?, ?, ?, ?, ?, ?, now())
        on conflict (account_id, slot) do update set
          name = excluded.name, cards = excluded.cards,
          troop = excluded.troop, branch = excluded.branch,
          updated_at = now()
        """)
        .params(accountId, deck.slot(), deck.name(),
            deck.cards().toArray(String[]::new), deck.troop(), deck.branch())
        .update();
  }

  private Deck map(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    java.sql.Array cards = rs.getArray("cards");
    return new Deck(
        rs.getInt("slot"),
        rs.getString("name"),
        List.of((String[]) cards.getArray()),
        rs.getString("troop"),
        rs.getString("branch"));
  }
}
