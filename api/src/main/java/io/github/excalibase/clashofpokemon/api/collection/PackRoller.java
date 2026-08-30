package io.github.excalibase.clashofpokemon.api.collection;

import io.github.excalibase.clashofpokemon.api.content.Content;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * What is in a chest.
 *
 * A faithful port of the client's `core/packs.ts`, and it has to stay faithful:
 * the client still shows the reveal, so if the two disagree a player watches
 * one pack and receives another.
 *
 * The rules themselves are NOT written here -- they arrive in `content.json`,
 * exported from the same TypeScript the client uses. This file is the algorithm
 * only. That split is deliberate: an algorithm ported once and reviewed is
 * safe, but a table of weights transcribed by hand goes stale the first time
 * somebody tunes one side and forgets the other.
 *
 * The order draws are taken in is load-bearing. For each card: pick the card,
 * then roll shiny, then roll the face. Reordering those would still produce a
 * legal pack while producing a *different* pack from the same seed, which is
 * exactly the kind of difference that survives testing and surfaces in
 * production.
 */
public final class PackRoller {

  /** One card as rolled: which card, which face, and whether it shone. */
  public record Pull(String cardId, String sheet, String rarity, Integer emotion, boolean shiny) {

    /**
     * The key this pull is stored under, built the same way the client builds
     * it. If these two ever disagree a bought face becomes invisible to the
     * collection that paid for it.
     */
    public String variant() {
      String face = emotion == null || emotion == 0 ? "" : "#e" + emotion;
      return cardId + face + (shiny ? "#shiny" : "");
    }
  }

  private final Content.Packs rules;
  private final List<Content.Card> pool;
  private final Set<String> shinySheets;

  public PackRoller(Content.Packs rules, List<Content.Card> cards) {
    // A deployed image whose content.json predates the chest rules would give
    // a null here, and the NPE would come out of a @Service constructor -- so
    // the whole API would fail to start, over a feature nobody had used yet.
    // Say what is actually wrong instead.
    if (rules == null) {
      throw new IllegalStateException(
          "content.json has no `packs` block. Re-run `npm run export:content` in "
          + "the client and rebuild: the chest rules are exported from there, not "
          + "written here.");
    }
    this.rules = rules;
    this.pool = List.copyOf(cards);
    this.shinySheets = Set.copyOf(
        rules.shinySheets() == null ? List.of() : rules.shinySheets());
  }

  public List<Pull> open(RandomGenerator rng) {
    Set<String> taken = new HashSet<>();
    List<Pull> out = new ArrayList<>();

    // Without replacement: two of a card in one chest is one card and some
    // shards wearing a costume, and it reads as the game being broken.
    for (int i = 0; i < rules.size() - 1; i++) {
      Content.Card card = draw(available(taken), rng);
      if (card == null) break;
      taken.add(card.id());
      out.add(dress(card, rng));
    }

    // The card the chest ends on, drawn from epic-and-better. Weighted within
    // that band too, so a legendary is still rarer than a unique.
    List<Content.Card> headline = available(taken).stream()
        .filter(c -> rules.headlineRarities().contains(c.rarity()))
        .toList();
    Content.Card last = draw(headline.isEmpty() ? available(taken) : headline, rng);
    if (last != null) {
      taken.add(last.id());
      out.add(dress(last, rng));
    }
    return List.copyOf(out);
  }

  private List<Content.Card> available(Set<String> taken) {
    return pool.stream().filter(c -> !taken.contains(c.id())).toList();
  }

  private int weightOf(Content.Card c) {
    return rules.perCardWeight().getOrDefault(c.rarity(), 1);
  }

  /** One weighted draw from a pool the caller has already filtered. */
  private Content.Card draw(List<Content.Card> pool, RandomGenerator rng) {
    if (pool.isEmpty()) return null;
    long total = pool.stream().mapToLong(this::weightOf).sum();
    if (total <= 0) return pool.get(0);
    double roll = rng.nextDouble() * total;
    for (Content.Card c : pool) {
      roll -= weightOf(c);
      if (roll <= 0) return c;
    }
    // Floating point can leave a sliver; the last card is the honest answer.
    return pool.get(pool.size() - 1);
  }

  /** Shiny first, then the face -- the client's order, and it must not change. */
  private Pull dress(Content.Card card, RandomGenerator rng) {
    boolean shiny = shinySheets.contains(card.sheet()) && rng.nextDouble() < rules.shinyChance();
    Integer emotion = rollFace(card.sheet(), shiny, rng);
    return new Pull(card.id(), card.sheet(), card.rarity(), emotion, shiny);
  }

  /**
   * Which face the pull wears, weighted by 1/cost.
   *
   * That weighting is why the shop price and the pull odds never need tuning to
   * agree -- they are the same ladder read twice. A creature with one face (or
   * none) keeps a null emotion, which renders from the shared portrait sheet
   * rather than a per-creature one that may not exist.
   */
  private Integer rollFace(String sheet, boolean shiny, RandomGenerator rng) {
    if (rules.faces() == null) return null;
    Content.Packs.Faces faces = rules.faces().get(sheet);
    if (faces == null) return null;
    List<Integer> pool = shiny ? faces.s() : faces.n();
    if (pool == null || pool.size() < 2) return null;

    double total = 0;
    for (int e : pool) total += 1.0 / costOf(e);
    double roll = rng.nextDouble() * total;
    for (int e : pool) {
      roll -= 1.0 / costOf(e);
      if (roll <= 0) return e;
    }
    return pool.get(pool.size() - 1);
  }

  private int costOf(int emotion) {
    List<Integer> costs = rules.emotionCost();
    return emotion >= 0 && emotion < costs.size() ? costs.get(emotion) : costs.get(0);
  }

  /** What a repeated pull is worth in that creature's shards. */
  public int shardsFor(Pull p) {
    return p.shiny() ? rules.shardsPerShinyDuplicate() : rules.shardsPerDuplicate();
  }

  /** What a face costs to buy outright. Shiny triples, as upstream. */
  public int faceCost(int emotion, boolean shiny) {
    int base = costOf(emotion);
    return shiny ? base * 3 : base;
  }
}
