package io.github.excalibase.clashofpokemon.game.net;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.net.URI;
import java.time.Clock;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Who is on the other end of this socket. */
@Component
public class Tickets {

  /** A ticket cannot outlive this, so neither need the ids we remember. */
  static final long REPLAY_WINDOW_MS = 90_000;

  /** A ticket that is not one. Every kind of wrong looks the same on purpose. */
  public static class BadTicket extends RuntimeException {
    public BadTicket(String message) {
      super(message);
    }
  }

  public record Ticket(String accountId, String contentVersion) {}

  /** Ticket ids already spent, and when they may be forgotten. */
  private final Map<String, Long> spent = new ConcurrentHashMap<>();

  private final DefaultJWTProcessor<SecurityContext> processor;
  private final Clock clock;

  @org.springframework.beans.factory.annotation.Autowired
  public Tickets(@Value("${clash.api:http://localhost:4500}") String api) {
    this(api, Clock.systemUTC());
  }

  Tickets(String api, Clock clock) {
    this.clock = clock;
    JWKSource<SecurityContext> keys;
    try {
      keys = JWKSourceBuilder.create(URI.create(api + "/internal/jwks").toURL()).build();
    } catch (java.net.MalformedURLException e) {
      throw new IllegalArgumentException("meta tier address is not a url: " + api, e);
    }
    this.processor = new DefaultJWTProcessor<>();
    processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
  }

  /** For tests, and for a node running without a meta tier in front of it. */
  Tickets(DefaultJWTProcessor<SecurityContext> processor, Clock clock) {
    this.processor = processor;
    this.clock = clock;
  }

  /** Check a ticket, and spend it. */
  public Ticket redeem(String token) {
    JWTClaimsSet claims;
    try {
      claims = processor.process(token, null);
    } catch (Exception e) {
      throw new BadTicket("ticket rejected");
    }

    String sub = claims.getSubject();
    String jti = claims.getJWTID();
    if (sub == null || jti == null) throw new BadTicket("ticket rejected");

    long now = clock.millis();
    spent.values().removeIf(expires -> expires <= now);
    if (spent.putIfAbsent(jti, now + REPLAY_WINDOW_MS) != null) {
      throw new BadTicket("ticket already used");
    }

    Object cv = claims.getClaim("cv");
    return new Ticket(sub, cv == null ? "" : cv.toString());
  }

  /** For tests: a fresh process should not inherit spent ids. */
  void forgetAllSpent() {
    spent.clear();
  }
}
