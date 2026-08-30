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
        select id, display_name, guest, avatar, username,
               created_at, wins, losses, draws
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

  /**
   * Bind a username and a password to an account that already exists.
   *
   * `guest` goes false here and nowhere else: it is the one thing that
   * distinguishes an account somebody can get back into from one that lives
   * or dies with a token in a browser.
   */
  public void registerCredentials(String id, String username, String passwordHash) {
    db.sql("""
        update account
           set username = ?, password_hash = ?, guest = false
         where id = ?
        """).params(username, passwordHash, id).update();
  }

  /**
   * An account and its password hash, found by name without regard to case.
   *
   * The hash is deliberately not on `Account`: that record is returned from
   * `/v1/me`, handed to the menu and serialised into a public profile, and a
   * field that must never be sent anywhere has no business travelling with
   * the one that is sent everywhere.
   */
  public Optional<WithSecret> findByUsername(String username) {
    return db.sql("""
        select id, display_name, guest, avatar, username,
               created_at, wins, losses, draws, password_hash
        from account where lower(username) = lower(?)
        """).param(username).query((rs, n) -> new WithSecret(
            new Account(
                rs.getString("id"), rs.getString("display_name"),
                rs.getBoolean("guest"), rs.getString("avatar"),
                rs.getString("username"),
                rs.getObject("created_at", java.time.OffsetDateTime.class),
                rs.getInt("wins"), rs.getInt("losses"), rs.getInt("draws")),
            rs.getString("password_hash")))
        .optional();
  }

  /** Only ever built inside this class, and never returned past the service. */
  public record WithSecret(Account account, String passwordHash) {}

  public void touch(String id) {
    db.sql("update account set last_seen_at = now() where id = ?").param(id).update();
  }
}
