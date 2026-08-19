package io.github.excalibase.clashofpokemon.api.feedback;

import java.time.Instant;
import java.util.Map;

/** One thing a player told us. */
public record Report(
    long id,
    String accountId,
    Kind kind,
    String message,
    Map<String, Object> context,
    Instant createdAt,
    Instant handledAt) {}
