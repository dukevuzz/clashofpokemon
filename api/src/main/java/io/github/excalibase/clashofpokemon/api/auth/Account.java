package io.github.excalibase.clashofpokemon.api.auth;

import java.time.OffsetDateTime;

/** A player. A guest and a registered player are the same thing here. */
public record Account(
    String id,
    String displayName,
    boolean guest,
    /** The creature they wear. Null until they choose one. */
    String avatar,
    /** How they log in. Null for a guest, who has no way back in but a token. */
    String username,
    OffsetDateTime createdAt,
    int wins,
    int losses,
    int draws) {}
