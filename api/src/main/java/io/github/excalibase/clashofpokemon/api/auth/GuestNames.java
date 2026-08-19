package io.github.excalibase.clashofpokemon.api.auth;

import java.security.SecureRandom;
import java.util.List;

/** Readable names for people who never chose one. */
final class GuestNames {

  private static final List<String> STEMS = List.of(
      "Ember", "Ripple", "Pebble", "Gust", "Thorn", "Cinder", "Quartz",
      "Drift", "Bramble", "Cobble", "Marsh", "Flint", "Willow", "Ash");

  private final SecureRandom random = new SecureRandom();

  String next() {
    return STEMS.get(random.nextInt(STEMS.size())) + (100 + random.nextInt(9900));
  }

  private GuestNames() {}

  static GuestNames create() {
    return new GuestNames();
  }
}
