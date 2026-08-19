package io.github.excalibase.clashofpokemon.api.auth;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Two tokens, because they are exposed differently. */
@Service
public class TokenService {

  private static final Duration REFRESH_LIFETIME = Duration.ofDays(30);

  private final JdbcClient db;
  private final AccessTokens access;

  TokenService(JdbcClient db, AccessTokens access) {
    this.db = db;
    this.access = access;
  }

  /** A fresh chain. Used when an account is created or signs in. */
  @Transactional
  public String issueRefresh(String accountId) {
    return issueRefresh(accountId, null);
  }

  private String issueRefresh(String accountId, Long replacing) {
    String token = Secrets.token("rt");
    Long id = db.sql("""
        insert into refresh_token (account_id, token_hash, expires_at)
        values (?, ?, ?) returning id
        """)
        // OffsetDateTime rather than Instant: the Postgres driver cannot infer
        // a SQL type for an Instant and refuses the statement outright. The
        // column is timestamptz, and this is the type that says so.
        .params(accountId, Secrets.hash(token),
            OffsetDateTime.now().plus(REFRESH_LIFETIME))
        .query(Long.class).single();

    if (replacing != null) {
      db.sql("update refresh_token set used_at = now(), replaced_by = ? where id = ?")
          .params(id, replacing).update();
    }
    return token;
  }

  /** Spend a refresh token for a session. */
  // `noRollbackFor` is load-bearing, not tidiness.
  @Transactional(noRollbackFor = AuthFailed.class)
  public Session refresh(String token) {
    Row row = lookup(token).orElseThrow(AuthFailed::new);

    if (row.revoked() || row.expiresAt().isBefore(OffsetDateTime.now())) {
      throw new AuthFailed();
    }
    if (row.usedAt() != null) {
      // Presented after it was rotated: two holders. Which is the owner is
      // unknowable, so end every session on this account.
      revokeAllFor(row.accountId());
      throw new AuthFailed();
    }

    String next = issueRefresh(row.accountId(), row.id());
    return new Session(row.accountId(), access.mint(row.accountId()), next);
  }

  @Transactional
  public void logout(String token) {
    lookup(token).ifPresent(row ->
        db.sql("update refresh_token set revoked = true where id = ?")
            .param(row.id()).update());
  }

  /** Who this access token belongs to. Throws if it is not a valid one. */
  public String accountFor(String accessToken) {
    return access.subject(accessToken);
  }

  private void revokeAllFor(String accountId) {
    db.sql("update refresh_token set revoked = true where account_id = ? and not revoked")
        .param(accountId).update();
  }

  private Optional<Row> lookup(String token) {
    return db.sql("""
        select id, account_id, expires_at, used_at, revoked
        from refresh_token where token_hash = ?
        """).param(Secrets.hash(token)).query(Row.class).optional();
  }

  private record Row(
      long id, String accountId, OffsetDateTime expiresAt,
      OffsetDateTime usedAt, boolean revoked) {}
}
