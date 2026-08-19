package io.github.excalibase.clashofpokemon.api.ticket;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Permission to open a game socket, good for one connection. */
@Service
public class TicketService {

  private static final Duration DEFAULT_LIFETIME = Duration.ofSeconds(60);

  private final TicketKeys keys;
  private final ContentService content;
  private final Duration lifetime;

  /** The one Spring uses. */
  @Autowired
  TicketService(TicketKeys keys, ContentService content) {
    this(keys, content, DEFAULT_LIFETIME);
  }

  TicketService(TicketKeys keys, ContentService content, Duration lifetime) {
    this.keys = keys;
    this.content = content;
    this.lifetime = lifetime;
  }

  TicketKeys keys() {
    return keys;
  }

  public IssuedTicket issue(String accountId) {
    Instant expiry = Instant.now().plus(lifetime);
    var claims = new JWTClaimsSet.Builder()
        .subject(accountId)
        // A fresh id per ticket: the game server remembers spent ones for the
        // ticket's lifetime, which is what makes single-use enforceable
        // without a database between the two services.
        .jwtID(UUID.randomUUID().toString())
        .expirationTime(Date.from(expiry))
        .issueTime(Date.from(Instant.now()))
        // The roster this ticket was minted against. A client built on another
        // one is turned away rather than allowed into a match where the two
        // disagree about what a card does.
        .claim("cv", content.version())
        .build();

    var header = new JWSHeader.Builder(JWSAlgorithm.RS256)
        .keyID(keys.signing().getKeyID())
        .type(JOSEObjectType.JWT)
        .build();

    try {
      var jwt = new SignedJWT(header, claims);
      jwt.sign(new RSASSASigner(keys.signing()));
      return new IssuedTicket(jwt.serialize(), lifetime.toSeconds());
    } catch (Exception e) {
      throw new IllegalStateException("cannot sign a ticket", e);
    }
  }
}
