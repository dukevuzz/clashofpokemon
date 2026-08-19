package io.github.excalibase.clashofpokemon.game.net;

import io.github.excalibase.clashofpokemon.game.rules.Card;
import io.github.excalibase.clashofpokemon.game.rules.Cards;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Every card that can appear, in an order both ends agree on. */
public final class CardTable {

  /** Reserved: "no card here" -- an empty hand slot, or no next card. */
  public static final int NO_CARD = 0xffff;

  private static final List<String> IDS;
  private static final Map<String, Integer> INDEX;
  private static final String HASH;

  static {
    List<String> ids = new ArrayList<>();
    // Cards.all() is the 127 a deck may hold; the table is every card that can
    // *appear*, which is what byId resolves and what a hand can end up holding.
    for (Card c : Cards.wireTable()) ids.add(c.id());
    IDS = List.copyOf(ids);

    Map<String, Integer> index = new HashMap<>();
    for (int i = 0; i < IDS.size(); i++) index.put(IDS.get(i), i);
    INDEX = Map.copyOf(index);

    HASH = fingerprint(IDS);
  }

  private CardTable() {}

  public static int size() {
    return IDS.size();
  }

  public static int indexOf(String id) {
    if (id == null) return NO_CARD;
    Integer i = INDEX.get(id);
    if (i == null) {
      throw new IllegalArgumentException(
          "card \"" + id + "\" is not in the wire table -- regenerate it");
    }
    return i;
  }

  public static String idAt(int index) {
    if (index == NO_CARD || index < 0 || index >= IDS.size()) return null;
    return IDS.get(index);
  }

  public static Card cardAt(int index) {
    String id = idAt(index);
    return id == null ? null : Cards.byId(id);
  }

  /** Sent in the handshake, so a client built against another roster is refused. */
  public static String contentHash() {
    return HASH;
  }

  /** FNV-1a over the sorted ids. */
  private static String fingerprint(List<String> ids) {
    int h = 0x811c9dc5;
    for (String id : ids) {
      for (int i = 0; i < id.length(); i++) {
        h ^= id.charAt(i);
        h *= 0x01000193;
      }
      h ^= 0x2c;
      h *= 0x01000193;
    }
    return String.format("%08x", h & 0xffffffffL);
  }
}
