package io.github.excalibase.clashofpokemon.api.ticket;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import java.time.Instant;
import java.util.Date;

/** The other end of the ticket, and the reason there is a key pair. */
public class TicketVerifier {

  private final JWKSet publicKeys;

  public TicketVerifier(String jwksJson) {
    try {
      this.publicKeys = JWKSet.parse(jwksJson);
    } catch (Exception e) {
      throw new IllegalStateException("unreadable JWKS", e);
    }
  }

  public TicketClaims verify(String token) {
    try {
      SignedJWT jwt = SignedJWT.parse(token);
      RSAKey key = (RSAKey) publicKeys.getKeyByKeyId(jwt.getHeader().getKeyID());
      if (key == null) throw new BadTicket("unknown signing key");
      if (!jwt.verify(new RSASSAVerifier(key))) throw new BadTicket("bad signature");

      var claims = jwt.getJWTClaimsSet();
      Date expiry = claims.getExpirationTime();
      if (expiry == null || expiry.toInstant().isBefore(Instant.now())) {
        throw new BadTicket("expired");
      }
      return new TicketClaims(
          claims.getSubject(), claims.getJWTID(), claims.getStringClaim("cv"));
    } catch (BadTicket bad) {
      throw bad;
    } catch (Exception malformed) {
      // A ticket that will not even parse is refused the same way as one that
      // fails verification: a caller learns only that it did not work.
      throw new BadTicket("malformed");
    }
  }
}
