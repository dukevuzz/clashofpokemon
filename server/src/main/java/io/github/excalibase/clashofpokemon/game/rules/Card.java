package io.github.excalibase.clashofpokemon.game.rules;

import java.util.List;

/** A creature, as the rules need it. */
public record Card(
    String id,
    String name,
    String sheet,
    int elixir,
    int hp,
    int damage,
    int range,
    int aggro,
    double speed,
    double attackRate,
    int castEvery,
    int def,
    int speDef,
    double mass,
    int count,
    boolean flying,
    boolean jumpsRiver,
    List<String> targets,
    String skill,
    String rarity,
    String role,
    double deployDelay,
    String delivery,
    List<String> forms,
    /** 1 to 4. Powered moves scale off it. */
    int stage,
    /** The skill's damage, resolved from the ability table at export time. */
    double skillAmount,
    /** "physical", "special" or "none" -- which armour reduces it. */
    String skillResist) {}
