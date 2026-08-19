package io.github.excalibase.clashofpokemon.api.match;

/** One player in a match: which team, and which seat within it. */
public record MatchParticipant(String accountId, int team, int seat) {}
