package io.github.excalibase.clashofpokemon.game.rules;

import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;

/** What a card becomes, and how many plays it takes. */
public final class Evolution {

  private static final Map<Integer, Integer> PLAYS_FOR_STAGE = Rules.playsForStage();
  private static final Map<String, String> NEXT = Rules.evolutionNext();
  private static final Map<String, Integer> STAGE = Rules.evolutionStage();
  private static final Map<String, List<String>> BRANCHES = Rules.evolutionBranches();

  /** How many of a card's branches are offered at once. */
  public static final int BRANCH_OFFER = Rules.branchOffer();

  private Evolution() {}

  /** The single form this card grows into, or null if it is terminal. */
  public static String nextOf(String species) {
    return species == null ? null : NEXT.get(species);
  }

  public static int stageOf(String species) {
    return STAGE.getOrDefault(species, 1);
  }

  /** How many plays this card needs to grow, or 0 if it never does. */
  public static int playsNeeded(Card card) {
    if (card == null) return 0;
    if (BRANCHES.containsKey(card.id())) {
      return PLAYS_FOR_STAGE.getOrDefault(stageOf(card.id()), 0);
    }
    if (nextOf(card.id()) == null) return 0;
    return PLAYS_FOR_STAGE.getOrDefault(stageOf(card.id()), 0);
  }

  /** Everything this card can branch into, or null if it does not branch. */
  public static List<String> branchesFor(String species) {
    return BRANCHES.get(species);
  }

  /** Three of the branches, drawn at random. */
  public static List<String> offerFor(String species, RandomGenerator rng) {
    List<String> pool = branchesFor(species);
    if (pool == null || pool.isEmpty()) return null;

    List<String> copy = new java.util.ArrayList<>(pool);
    // The same Fisher-Yates the TypeScript uses, in the same direction, so the
    // same seed offers the same three.
    for (int i = copy.size() - 1; i > 0; i--) {
      int j = (int) Math.floor(rng.nextDouble() * (i + 1));
      String swap = copy.get(i);
      copy.set(i, copy.get(j));
      copy.set(j, swap);
    }
    return List.copyOf(copy.subList(0, Math.min(BRANCH_OFFER, copy.size())));
  }

  /** The whole line a card belongs to, from where it stands to the end. */
  public static List<String> chainOf(String species) {
    List<String> out = new java.util.ArrayList<>();
    String at = species;
    while (at != null && !out.contains(at)) {
      out.add(at);
      List<String> branches = branchesFor(at);
      if (branches != null) {
        out.addAll(branches);
        break;
      }
      at = nextOf(at);
    }
    return List.copyOf(out);
  }
}
