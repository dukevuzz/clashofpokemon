package io.github.excalibase.clashofpokemon.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

/** Making secrets, and storing them in a form that is not a secret. */
final class Secrets {

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Base64.Encoder URL = Base64.getUrlEncoder().withoutPadding();

  private Secrets() {}

  /** 256 bits. Long enough that guessing is not a strategy. */
  static String token(String prefix) {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return prefix + "_" + URL.encodeToString(bytes);
  }

  /** What goes in the database. */
  static String hash(String token) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256")
          .digest(token.getBytes(StandardCharsets.UTF_8));
      return URL.encodeToString(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is not available", e);
    }
  }
}
