package io.github.excalibase.clashofpokemon.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Short-lived proof of who you are, signed rather than stored. */
@Component
public class AccessTokens {

  private static final Duration LIFETIME = Duration.ofMinutes(15);
  private static final Base64.Encoder ENC = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder DEC = Base64.getUrlDecoder();

  private final SecretKeySpec key;

  AccessTokens(@Value("${lane.auth.secret:}") String configured) {
    this.key = new SecretKeySpec(secret(configured).getBytes(StandardCharsets.UTF_8), "HmacSHA256");
  }

  /** A generated secret in development, a configured one everywhere else. */
  private static String secret(String configured) {
    if (!configured.isBlank()) return configured;
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return ENC.encodeToString(bytes);
  }

  String mint(String accountId) {
    String body = accountId + "." + Instant.now().plus(LIFETIME).getEpochSecond();
    return ENC.encodeToString(body.getBytes(StandardCharsets.UTF_8)) + "." + sign(body);
  }

  String subject(String token) {
    String[] parts = token.split("\\.");
    if (parts.length != 2) throw new AuthFailed();

    String body;
    try {
      body = new String(DEC.decode(parts[0]), StandardCharsets.UTF_8);
    } catch (IllegalArgumentException notBase64) {
      throw new AuthFailed();
    }
    if (!constantTimeEquals(sign(body), parts[1])) throw new AuthFailed();

    int dot = body.lastIndexOf('.');
    if (dot < 0) throw new AuthFailed();
    if (Instant.now().getEpochSecond() > Long.parseLong(body.substring(dot + 1))) {
      throw new AuthFailed();
    }
    return body.substring(0, dot);
  }

  private String sign(String body) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(key);
      return ENC.encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException("cannot sign access tokens", e);
    }
  }

  /** Comparing signatures byte by byte leaks how much of a forgery was right. */
  private static boolean constantTimeEquals(String a, String b) {
    return java.security.MessageDigest.isEqual(
        a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
  }
}
