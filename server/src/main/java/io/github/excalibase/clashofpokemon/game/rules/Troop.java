package io.github.excalibase.clashofpokemon.game.rules;

/** A creature riding a lane tower, and the statline it gives that tower. */
public record Troop(
    String id, String name, String species,
    int hp, int damage, double reach, double rate,
    Integer volleyShots, Double volleyReload) {}
