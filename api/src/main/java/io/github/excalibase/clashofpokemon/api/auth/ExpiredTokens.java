package io.github.excalibase.clashofpokemon.api.auth;

import java.time.Duration;
import java.time.OffsetDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Forgetting refresh tokens nobody can use any more. */
@Component
public class ExpiredTokens {

  private static final Logger log = LoggerFactory.getLogger(ExpiredTokens.class);

  /** How long a dead token stays readable before it is forgotten entirely. */
  static final Duration GRACE = Duration.ofDays(7);

  private final JdbcClient db;

  ExpiredTokens(JdbcClient db) {
    this.db = db;
  }

  /** Hourly, and deliberately unremarkable. */
  @Scheduled(fixedDelayString = "${clash.token-sweep-ms:3600000}",
      initialDelayString = "${clash.token-sweep-ms:3600000}")
  public void sweep() {
    int gone = forget(OffsetDateTime.now().minus(GRACE));
    if (gone > 0) log.info("forgot {} expired refresh token(s)", gone);
  }

  /** Package-visible so a test can name the moment rather than wait for it. */
  int forget(OffsetDateTime before) {
    return db.sql("delete from refresh_token where expires_at < ?").param(before).update();
  }
}
