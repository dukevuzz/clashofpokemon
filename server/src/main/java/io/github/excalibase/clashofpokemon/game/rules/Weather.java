package io.github.excalibase.clashofpokemon.game.rules;

import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What the sky is doing, read off the decks that were brought.
 *
 * <p>Ported from {@code client/src/core/weather.ts} and kept in step with it by
 * the differential test. Nobody picks the weather from a menu: play four Fire
 * cards between the two of you and the arena goes into drought.
 *
 * <p>Weather is not a filter over the screen, it is a rule. Rain powers Water
 * and quenches Fire, sun does the reverse. A sky that only changed the colours
 * would be missing the point of the mechanic.
 */
public final class Weather {

  /** Every weather a pair of decks can produce. */
  public enum Kind {
    DROUGHT, RAIN, SNOW, STORM, WINDY, SANDSTORM, ZENITH, NIGHT, MISTY, SMOG, MURKY
  }

  /**
   * Which type summons which sky.
   *
   * <p>Taken from Pokemon Auto Chess. Two of its thirteen entries are
   * deliberately absent: {@code WILD} has no home because we have no WILD type,
   * and {@code NORMAL -> NEUTRAL} is dropped because a neutral sky is the
   * absence of weather rather than a kind of it.
   *
   * <p>Six types are therefore unmapped -- BUG, DRAGON, FIGHTING, PSYCHIC, ROCK
   * and STEEL -- and a deck built on those cannot turn the sky on at all.
   */
  private static final Map<String, Kind> BY_TYPE = Map.ofEntries(
      Map.entry("FIRE", Kind.DROUGHT),
      Map.entry("WATER", Kind.RAIN),
      Map.entry("ICE", Kind.SNOW),
      Map.entry("ELECTRIC", Kind.STORM),
      Map.entry("FLYING", Kind.WINDY),
      Map.entry("GROUND", Kind.SANDSTORM),
      Map.entry("GRASS", Kind.ZENITH),
      Map.entry("DARK", Kind.NIGHT),
      Map.entry("FAIRY", Kind.MISTY),
      Map.entry("POISON", Kind.SMOG),
      Map.entry("GHOST", Kind.MURKY));

  /**
   * How many cards of a type it takes to claim the sky.
   *
   * <p>Auto Chess uses 8, sized for a board that holds far more than a hand.
   * Rescaled to 4 -- so weather is a commitment rather than an accident.
   */
  public static final int THRESHOLD = 4;

  /**
   * How far weather may tilt a hit.
   *
   * <p>Deliberately small. The type chart already reaches 4x on a double
   * weakness, and a canon-sized 1.5x on top would let a matchup decide a match
   * before either player makes a decision.
   */
  public static final double SWING = 1.2;

  /** The type a weather favours, and the one it holds back. */
  private record Pair(String up, String down) {}

  /**
   * Each weather boosts the type that summoned it and damps that type's answer.
   *
   * <p>Four are canon. The other seven are Auto Chess's inventions given the
   * same shape, so the pairing is guessable without a tooltip -- rain beats
   * fire because water beats fire, not because a table says so.
   */
  private static final Map<Kind, Pair> BOOSTS = new EnumMap<>(Map.ofEntries(
      Map.entry(Kind.DROUGHT, new Pair("FIRE", "WATER")),
      Map.entry(Kind.RAIN, new Pair("WATER", "FIRE")),
      Map.entry(Kind.SNOW, new Pair("ICE", "GRASS")),
      Map.entry(Kind.SANDSTORM, new Pair("GROUND", "FLYING")),
      Map.entry(Kind.STORM, new Pair("ELECTRIC", "WATER")),
      Map.entry(Kind.WINDY, new Pair("FLYING", "BUG")),
      Map.entry(Kind.ZENITH, new Pair("GRASS", "ROCK")),
      Map.entry(Kind.NIGHT, new Pair("DARK", "PSYCHIC")),
      Map.entry(Kind.MISTY, new Pair("FAIRY", "DRAGON")),
      Map.entry(Kind.SMOG, new Pair("POISON", "FAIRY")),
      Map.entry(Kind.MURKY, new Pair("GHOST", "NORMAL"))));

  private Weather() {}

  /**
   * The weather a set of cards brings, or null for none.
   *
   * <p>A tie produces no weather. That single rule is what keeps the sky from
   * flickering: without it, two types level with each other would hand the sky
   * back and forth on every recount. It is also what gives the mechanic
   * counterplay -- four Fire answered by four Water cancels.
   */
  public static Kind forCards(List<Card> cards) {
    Map<Kind, Integer> count = new EnumMap<>(Kind.class);
    for (Card card : cards) {
      // A dual-type card argues for both of its skies, but only once each.
      Set<String> types = new HashSet<>(TypeChart.typesOf(card.sheet()));
      for (String type : types) {
        Kind weather = BY_TYPE.get(type);
        if (weather != null) count.merge(weather, 1, Integer::sum);
      }
    }

    Kind best = null;
    int top = 0;
    boolean tied = false;
    for (Map.Entry<Kind, Integer> e : count.entrySet()) {
      int n = e.getValue();
      if (n > top) {
        top = n;
        best = e.getKey();
        tied = false;
      } else if (n == top) {
        tied = true;
      }
    }
    return !tied && top >= THRESHOLD ? best : null;
  }

  /**
   * The one sky both players are under, read from both decks at once.
   *
   * <p>There is a single arena, so there is a single answer, and it cannot
   * depend on which seat is asking -- a replay and a spectator have no seat.
   */
  public static Kind forMatch(List<Card> one, List<Card> two) {
    List<Card> both = new java.util.ArrayList<>(one.size() + two.size());
    both.addAll(one);
    both.addAll(two);
    return forCards(both);
  }

  /**
   * What the weather does to a hit from a creature of these types.
   *
   * <p>The damp is the exact reciprocal of the boost, so what a weather grants
   * one type it takes from the other and total damage cannot quietly inflate.
   * A card that is both the favoured and the held-back type takes the boost:
   * being on the right side of the weather at all is enough.
   */
  public static double boost(Kind weather, List<String> types) {
    if (weather == null) return 1;
    Pair pair = BOOSTS.get(weather);
    if (types.contains(pair.up())) return SWING;
    if (types.contains(pair.down())) return 1 / SWING;
    return 1;
  }
}
