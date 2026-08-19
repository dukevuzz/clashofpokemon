package io.github.excalibase.clashofpokemon.api.auth;

/** Everything a brand new account needs before it can play. */
public interface NewAccountSetup {
  void prepare(String accountId);
}
