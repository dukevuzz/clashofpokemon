package io.github.excalibase.clashofpokemon.api.auth;

import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Reading and writing accounts. Nothing here decides anything. */
@Repository
public class AccountRepository {

  private final JdbcClient db;

  AccountRepository(JdbcClient db) {
    this.db = db;
  }

  public void insert(String id, String displayName) {
    db.sql("insert into account (id, display_name) values (?, ?)")
        .params(id, displayName).update();
  }

  public Optional<Account> find(String id) {
    return db.sql("""
        select id, display_name, guest, created_at, wins, losses, draws
        from account where id = ?
        """).param(id).query(Account.class).optional();
  }

  public void touch(String id) {
    db.sql("update account set last_seen_at = now() where id = ?").param(id).update();
  }
}
