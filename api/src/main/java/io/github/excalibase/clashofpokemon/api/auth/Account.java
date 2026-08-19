package io.github.excalibase.clashofpokemon.api.auth;

import java.time.OffsetDateTime;

/** A player. A guest and a registered player are the same thing here. */
public record Account(
    String id,
    String displayName,
    boolean guest,
    OffsetDateTime createdAt,
    int wins,
    int losses,
    int draws) {}
