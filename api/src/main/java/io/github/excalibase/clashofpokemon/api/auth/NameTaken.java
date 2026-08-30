package io.github.excalibase.clashofpokemon.api.auth;

/**
 * Somebody already answers to that name.
 *
 * Its own type rather than an IllegalArgumentException, because it is the one
 * refusal a sign-up form has to handle differently: every other rejection
 * means "fix what you typed" and this one means "that one is gone, pick
 * another". It maps to 409, not 400.
 */
public class NameTaken extends RuntimeException {
  public NameTaken(String username) {
    super("that username is taken: " + username);
  }
}
