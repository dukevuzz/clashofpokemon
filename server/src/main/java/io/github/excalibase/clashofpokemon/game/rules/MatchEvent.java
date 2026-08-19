package io.github.excalibase.clashofpokemon.game.rules;

import java.util.List;

/** What happened, said once. */
public sealed interface MatchEvent {

  record Spawn(Unit unit) implements MatchEvent {}

  /** Finished arriving: visible and dangerous from here. */
  record Ready(Unit unit) implements MatchEvent {}

  record Hit(Thing target, int amount, double mult, Thing source) implements MatchEvent {}

  record Cast(Unit unit, Thing target, String skill) implements MatchEvent {}

  record Afflicted(Unit unit, StatusKind kind, double seconds) implements MatchEvent {}

  record Shot(Thing from, Thing to, int amount, double mult) implements MatchEvent {}

  record Death(Thing thing) implements MatchEvent {}

  record TowerDown(Tower tower) implements MatchEvent {}

  record KingWakes(Tower tower) implements MatchEvent {}

  record Evolve(Side side, Card from, Card to) implements MatchEvent {}

  /** A branch offer, named so a late reply cannot answer a newer question. */
  record Choice(Side side, String id, Card from, List<Card> options) implements MatchEvent {}

  record Over(String result) implements MatchEvent {}
}
