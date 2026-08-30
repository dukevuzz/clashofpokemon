package io.github.excalibase.clashofpokemon.api.auth;

/** An account and a way back into it. Handed out by registering and by login. */
public record Credentials(Account account, String refresh) {}
