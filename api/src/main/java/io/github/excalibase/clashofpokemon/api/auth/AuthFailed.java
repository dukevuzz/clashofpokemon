package io.github.excalibase.clashofpokemon.api.auth;

/** The credential was no good. */
public class AuthFailed extends RuntimeException {
  public AuthFailed() {
    super("authentication failed");
  }
}
