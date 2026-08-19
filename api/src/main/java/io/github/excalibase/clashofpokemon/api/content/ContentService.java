package io.github.excalibase.clashofpokemon.api.content;

import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** What a card is, and which ones are real. */
@Service
public class ContentService {

  private static final String DEFAULT_RESOURCE = "content.json";

  private final Content content;
  private final Map<String, Content.Card> byId;
  private final Set<String> troopIds;
  private final Set<String> branchIds;

  public ContentService() {
    this(DEFAULT_RESOURCE);
  }

  ContentService(String resource) {
    this.content = read(resource);
    this.byId = content.cards().stream().collect(Collectors.toMap(
        Content.Card::id, Function.identity(), (a, b) -> a, LinkedHashMap::new));
    this.troopIds = content.troops().stream()
        .map(Content.Troop::id).collect(Collectors.toUnmodifiableSet());
    this.branchIds = Set.copyOf(content.branches());
  }

  /** Refuse to start rather than serve an empty roster. */
  private static Content read(String resource) {
    try (InputStream in = ContentService.class.getClassLoader()
        .getResourceAsStream(resource)) {
      if (in == null) {
        throw new IllegalStateException(
            "content missing: " + resource + " -- run `npm run export:content`");
      }
      return new ObjectMapper().readValue(in, Content.class);
    } catch (IOException e) {
      throw new IllegalStateException("content unreadable: " + resource, e);
    }
  }

  /** Identifies this roster. Travels in the ticket; a mismatch is refused. */
  public String version() {
    return content.version();
  }

  public List<Content.Card> cards() {
    return content.cards();
  }

  public List<Content.Troop> troops() {
    return content.troops();
  }

  public Content.Rules rules() {
    return content.rules();
  }

  public Optional<Content.Card> card(String id) {
    return Optional.ofNullable(byId.get(id));
  }

  /** Is this a card a deck may contain? */
  public boolean isKnownCard(String id) {
    return byId.containsKey(id);
  }

  public boolean isKnownTroop(String id) {
    return troopIds.contains(id);
  }

  /** One of the branches Eevee actually offers, for a pre-committed choice. */
  public boolean isKnownBranch(String id) {
    return branchIds.contains(id);
  }
}
