package io.github.excalibase.clashofpokemon.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Forgetting tokens nobody can use. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ExpiredTokensTest {

  @Autowired private ExpiredTokens expired;
  @Autowired private GuestService guests;
  @Autowired private TokenService tokens;
  @Autowired private JdbcClient db;

  private int rowsFor(String accountId) {
    return db.sql("select count(*) from refresh_token where account_id = ?")
        .param(accountId).query(Integer.class).single();
  }

  @Test
  void aLiveTokenIsNeverForgotten() {
    var guest = guests.create();
    tokens.refresh(guest.refresh());

    // Everything expiring before an hour ago -- which is nothing here.
    expired.forget(OffsetDateTime.now().minusHours(1));
    assertThat(rowsFor(guest.account().id())).isPositive();
  }

  @Test
  void aTokenLongPastItsExpiryIsForgotten() {
    var guest = guests.create();
    tokens.refresh(guest.refresh());
    String account = guest.account().id();
    assertThat(rowsFor(account)).isPositive();

    // Every row this account has, now well past expiry.
    db.sql("update refresh_token set expires_at = ? where account_id = ?")
        .params(OffsetDateTime.now().minusDays(60), account).update();

    assertThat(expired.forget(OffsetDateTime.now().minusDays(7))).isPositive();
    assertThat(rowsFor(account)).isZero();
  }

  @Test
  void aRecentlyExpiredTokenIsKeptLongEnoughToBeRecognised() {
    // Inside the grace period. Deleting these early turns "your session
    // ended" into "no such token", which is the same answer this service
    // gives to an outright forgery.
    var guest = guests.create();
    tokens.refresh(guest.refresh());
    String account = guest.account().id();

    db.sql("update refresh_token set expires_at = ? where account_id = ?")
        .params(OffsetDateTime.now().minusHours(2), account).update();

    expired.forget(OffsetDateTime.now().minus(ExpiredTokens.GRACE));
    assertThat(rowsFor(account)).isPositive();
  }

  @Test
  void sweepingAnEmptyTableIsHarmless() {
    assertThat(expired.forget(OffsetDateTime.now().minusYears(10))).isNotNegative();
  }

  @Test
  void theGraceIsShorterThanATokenLives() {
    // Otherwise rows would be deleted while still valid, logging everybody out.
    assertThat(ExpiredTokens.GRACE).isLessThan(java.time.Duration.ofDays(30));
  }
}
