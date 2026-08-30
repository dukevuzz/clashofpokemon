package io.github.excalibase.clashofpokemon.api.auth;

import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registering, and logging back in.
 *
 * The rule the whole class exists to protect: <b>registering does not create a
 * row.</b> It binds a username and a password to the account the caller is
 * already using, so a guest with two hundred matches signs up and still has two
 * hundred matches. An implementation that inserted instead would look correct
 * until the first player with a history used it, and then it would have thrown
 * their history away with no way to get it back.
 */
@Service
public class Accounts {

  /** Long enough to be a name, short enough to draw on one line. */
  private static final int NAME_MIN = 3;
  private static final int NAME_MAX = 24;

  /**
   * Letters, digits, underscore and hyphen.
   *
   * Deliberately narrow. A username is compared, printed beside a display name
   * to tell two people apart, and typed by somebody reading it off a screen --
   * spaces, dots and slashes each make one of those worse, and the set can be
   * widened later without invalidating a name that already exists.
   */
  private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-]+");

  /**
   * Twelve, not eight.
   *
   * There is no email on these accounts and so no way to reset one. A password
   * is the only thing standing between a player and losing everything, and a
   * short minimum here is a promise we cannot keep.
   */
  private static final int PASSWORD_MIN = 12;

  private final AccountRepository accounts;
  private final TokenService tokens;
  private final PasswordEncoder passwords = new BCryptPasswordEncoder();

  Accounts(AccountRepository accounts, TokenService tokens) {
    this.accounts = accounts;
    this.tokens = tokens;
  }

  /**
   * Bind credentials to the account already in hand.
   *
   * Takes an account id rather than looking one up, so the caller has to have
   * proved who they are first. There is no path here that registers somebody
   * other than the session holder.
   */
  @Transactional
  public Account register(String accountId, String username, String password) {
    var existing = accounts.find(accountId)
        .orElseThrow(() -> new IllegalArgumentException("no such account"));
    if (existing.username() != null) {
      throw new IllegalArgumentException("this account already has a username");
    }

    String name = cleanUsername(username);
    checkPassword(password);
    try {
      accounts.registerCredentials(accountId, name, passwords.encode(password));
    } catch (DuplicateKeyException taken) {
      // The unique index is the arbiter, not a select that ran a moment ago:
      // two sign-ups racing for one name both read "free" and one of them has
      // to lose here rather than at the second insert.
      throw new NameTaken(name);
    }
    return accounts.find(accountId).orElseThrow();
  }

  /**
   * Trade a username and password for a session.
   *
   * Every failure is the same failure. Telling an unknown name apart from a
   * wrong password turns this endpoint into a list of who has registered.
   */
  public Credentials logIn(String username, String password) {
    String name = username == null ? "" : username.strip();
    var found = accounts.findByUsername(name);

    // Hashed even when there is no account, so that a name nobody holds does
    // not answer measurably faster than one somebody does.
    String hash = found.map(AccountRepository.WithSecret::passwordHash).orElse(NO_SUCH_HASH);
    boolean ok = passwords.matches(password == null ? "" : password, hash);
    if (found.isEmpty() || !ok) {
      // No message: the same failure for a name nobody holds and a password
      // that is wrong, so the answer cannot be used to enumerate players.
      throw new AuthFailed();
    }

    var account = found.get().account();
    return new Credentials(account, tokens.issueRefresh(account.id()));
  }

  /**
   * A real BCrypt hash of a value nothing will ever present.
   *
   * `matches` against a malformed string returns immediately, which is the
   * timing signal this is here to remove.
   */
  private static final String NO_SUCH_HASH =
      "$2a$10$7EqJtq98hPqEX7fNZaFWoOa8Ie8XPGZ7bYr7YEHwOoZ8pF1qk0Yy2";

  private static String cleanUsername(String raw) {
    String name = raw == null ? "" : raw.strip();
    if (name.length() < NAME_MIN || name.length() > NAME_MAX) {
      throw new IllegalArgumentException(
          "a username is between " + NAME_MIN + " and " + NAME_MAX + " characters");
    }
    if (!NAME.matcher(name).matches()) {
      throw new IllegalArgumentException(
          "a username may use letters, digits, underscores and hyphens");
    }
    return name;
  }

  private static void checkPassword(String password) {
    if (password == null || password.length() < PASSWORD_MIN) {
      throw new IllegalArgumentException(
          "a password needs at least " + PASSWORD_MIN + " characters");
    }
  }
}
