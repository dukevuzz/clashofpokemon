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
        select id, display_name, guest, avatar, created_at, wins, losses, draws
        from account where id = ?
        """).param(id).query(Account.class).optional();
  }

  /**
   * Write only what was sent.
   *
   * `coalesce` leaves an absent field alone, which is what makes a rename and
   * a change of face independent calls. The avatar needs its own flag rather
   * than the same trick: null is a value there -- it is how a face is taken
   * off -- so "not sent" and "set to nothing" cannot be the same argument.
   */
  public void updateProfile(String id, String displayName, String avatar,
      boolean avatarSent) {
    db.sql("""
        update account
           set display_name = coalesce(?, display_name),
               avatar       = case when ? then ? else avatar end
         where id = ?
        """).params(displayName, avatarSent, avatar, id).update();
  }

  public void touch(String id) {
    db.sql("update account set last_seen_at = now() where id = ?").param(id).update();
  }
}
