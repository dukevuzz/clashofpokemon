package io.github.excalibase.clashofpokemon.api.auth;

/** What a client holds after signing in. */
public record Session(String accountId, String access, String refresh) {}

