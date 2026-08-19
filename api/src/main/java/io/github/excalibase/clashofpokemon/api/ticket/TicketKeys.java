package io.github.excalibase.clashofpokemon.api.ticket;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The key pair that signs game tickets. */
@Component
public class TicketKeys {

  private final RSAKey key;

  TicketKeys() {
    this(generateKey());
  }

  private TicketKeys(RSAKey key) {
    this.key = key;
  }

  public static TicketKeys generate() {
    return new TicketKeys(generateKey());
  }

  private static RSAKey generateKey() {
    try {
      return new RSAKeyGenerator(2048)
          .keyID(UUID.randomUUID().toString())
          .generate();
    } catch (Exception e) {
      throw new IllegalStateException("cannot generate a ticket key", e);
    }
  }

  RSAKey signing() {
    return key;
  }

  /** What the game server fetches. */
  public String publicJwks() {
    return new JWKSet(key.toPublicJWK()).toString();
  }
}
