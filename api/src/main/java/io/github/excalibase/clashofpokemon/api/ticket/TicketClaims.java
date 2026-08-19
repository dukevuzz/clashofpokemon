package io.github.excalibase.clashofpokemon.api.ticket;

/** What a verified ticket says. */
public record TicketClaims(String accountId, String id, String contentVersion) {}
