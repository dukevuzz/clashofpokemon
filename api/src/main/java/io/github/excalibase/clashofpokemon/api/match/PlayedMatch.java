package io.github.excalibase.clashofpokemon.api.match;

import java.time.OffsetDateTime;

/** A match as it appears in one player's history. */
public record PlayedMatch(
    String matchId, boolean won, boolean drawn, Reason reason,
    int durationMs, OffsetDateTime finishedAt) {}
