package io.github.excalibase.clashofpokemon.api.auth;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import org.springframework.stereotype.Service;

/**
 * The part of an account a player chooses: a name and a face.
 *
 * Neither is a credential and neither is unique. Changing them is allowed as
 * often as somebody likes -- what stops abuse is that a display name proves
 * nothing, so impersonating one gains nothing either.
 */
@Service
public class ProfileService {

  /** Long enough for a real name, short enough to draw on one line. */
  public static final int NAME_MAX = 24;

  private final AccountRepository accounts;
  private final ContentService content;

  ProfileService(AccountRepository accounts, ContentService content) {
    this.accounts = accounts;
    this.content = content;
  }

  public Account of(String accountId) {
    return accounts.find(accountId).orElseThrow(
        () -> new IllegalArgumentException("no such account"));
  }

  /**
   * Change what was sent and leave the rest.
   *
   * Null means "not sent". An empty avatar is different from an absent one:
   * it is how a player takes their face off, and it stores as null so the
   * client falls back to whatever its default is that week.
   */
  public Account update(String accountId, String displayName, String avatar) {
    String name = displayName == null ? null : cleanName(displayName);
    // Distinguished from "not sent" by the caller passing "" deliberately.
    boolean clearingAvatar = avatar != null && avatar.isBlank();
    String face = avatar == null || clearingAvatar ? null : cleanAvatar(avatar);

    if (name != null || avatar != null) {
      accounts.updateProfile(accountId, name, face, avatar != null);
    }
    return of(accountId);
  }

  private static String cleanName(String raw) {
    String name = raw.strip();
    if (name.isEmpty()) {
      throw new IllegalArgumentException("a name cannot be empty");
    }
    if (name.length() > NAME_MAX) {
      throw new IllegalArgumentException(
          "a name is at most " + NAME_MAX + " characters");
    }
    // Everything a name is drawn into is one line of text. A line break, a
    // control code or an invisible character in one is not decoration -- it
    // is a way to push text somewhere it was not meant to go, or to look
    // exactly like somebody else while not being them.
    for (int i = 0; i < name.length(); ) {
      int point = name.codePointAt(i);
      i += Character.charCount(point);
      if (Character.isISOControl(point) || isInvisible(point)) {
        throw new IllegalArgumentException("a name cannot contain that character");
      }
    }
    return name;
  }

  /** Zero-width and directional marks: characters that occupy no space. */
  private static boolean isInvisible(int point) {
    return switch (Character.getType(point)) {
      case Character.FORMAT, Character.CONTROL, Character.SURROGATE,
          Character.PRIVATE_USE, Character.UNASSIGNED, Character.LINE_SEPARATOR,
          Character.PARAGRAPH_SEPARATOR -> true;
      // A plain space is fine inside a name; the exotic ones are not, because
      // they look like one and do not compare like one.
      default -> point != ' ' && Character.isSpaceChar(point);
    };
  }

  private String cleanAvatar(String raw) {
    String id = raw.strip();
    // The deckable roster, not every card: an evolution is real and playable
    // but is reached rather than picked, so it is not a face on offer.
    if (!content.isKnownCard(id)) {
      throw new IllegalArgumentException("no such creature to wear: " + id);
    }
    return id;
  }
}
