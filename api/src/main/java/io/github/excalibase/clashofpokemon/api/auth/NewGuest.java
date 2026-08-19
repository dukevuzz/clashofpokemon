package io.github.excalibase.clashofpokemon.api.auth;

/** A freshly created guest, and the one secret that proves it is theirs. */
public record NewGuest(Account account, String refresh) {}
