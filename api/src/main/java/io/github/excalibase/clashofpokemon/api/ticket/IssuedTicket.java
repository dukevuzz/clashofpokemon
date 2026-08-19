package io.github.excalibase.clashofpokemon.api.ticket;

/** A ticket, and how long the client has to spend it. */
public record IssuedTicket(String token, long expiresIn) {}
