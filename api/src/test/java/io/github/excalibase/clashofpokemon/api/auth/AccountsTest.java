package io.github.excalibase.clashofpokemon.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Turning a guest into an account, and getting back into it.
 *
 * The one rule everything here exists to protect: registering must not create
 * a row. It fills credentials in on the row the player already has, so a guest
 * with two hundred matches signs up and still has two hundred matches. A
 * registration that inserted would be indistinguishable from a working one
 * right up until somebody with a history used it.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class AccountsTest {

  @Autowired GuestService guests;
  @Autowired Accounts accounts;
  @Autowired TokenService tokens;
  @Autowired AccountRepository repository;
  @Autowired JdbcClient db;

  /*
   * Unique per test, because the container is shared by every test class and
   * rows outlive the method that made them. A fixed "duc" passed on its own
   * and failed the moment a second test in this class had already taken it.
   */
  private static final java.util.concurrent.atomic.AtomicInteger SEQ =
      new java.util.concurrent.atomic.AtomicInteger();

  private static String aName() {
    return "player" + SEQ.incrementAndGet();
  }

  private int accountCount() {
    return db.sql("select count(*) from account").query(Integer.class).single();
  }

  private String played(int wins) {
    String id = guests.create().account().id();
    db.sql("update account set wins = ? where id = ?").params(wins, id).update();
    return id;
  }

  @Test
  void registeringKeepsTheAccountItWasCalledOn() {
    String id = played(200);
    int before = accountCount();
    var after = accounts.register(id, aName(), "correct horse battery");

    assertThat(after.id()).isEqualTo(id);
    assertThat(after.wins()).isEqualTo(200);
    assertThat(after.guest()).isFalse();
    // No new row. The whole point: an implementation that inserted would pass
    // every other test in this class and lose the player's history.
    assertThat(accountCount()).isEqualTo(before);
  }

  @Test
  void theSessionSurvivesRegistering() {
    // Signing up must not log you out of the account you are signing up.
    var guest = guests.create();
    accounts.register(guest.account().id(), aName(), "correct horse battery");

    var session = tokens.refresh(guest.refresh());
    assertThat(session.accountId()).isEqualTo(guest.account().id());
  }

  @Test
  void aUsernameBelongsToExactlyOnePerson() {
    String taken = aName();
    accounts.register(played(0), taken, "correct horse battery");
    assertThatThrownBy(() -> accounts.register(played(0), taken, "another password"))
        .isInstanceOf(NameTaken.class);
  }

  @Test
  void aUsernameIsComparedWithoutItsCase() {
    // Otherwise "Duc" and "duc" are two people, and one of them is pretending
    // to be the other.
    String taken = aName();
    accounts.register(played(0), taken, "correct horse battery");
    assertThatThrownBy(() ->
        accounts.register(played(0), taken.toUpperCase(java.util.Locale.ROOT), "another password"))
        .isInstanceOf(NameTaken.class);
  }

  @Test
  void oneAccountRegistersOnce() {
    String id = played(0);
    accounts.register(id, aName(), "correct horse battery");
    assertThatThrownBy(() -> accounts.register(id, aName(), "correct horse battery"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("already");
  }

  @Test
  void aUsernameHasRules() {
    for (String bad : new String[] {
      "", "  ", "a", "ab",                      // too short to be anybody
      "a".repeat(25),                           // too long for a line
      "duc vu", "duc@vu", "duc.vu", "duc/vu",   // not letters, digits, _ or -
    }) {
      assertThatThrownBy(() -> accounts.register(played(0), bad, "correct horse battery"))
          .as("username %s", bad)
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(accounts.register(played(0), aName() + "_vu-99", "correct horse battery"))
        .isNotNull();
  }

  @Test
  void aPasswordHasALength() {
    assertThatThrownBy(() -> accounts.register(played(0), aName(), "short"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("password");
  }

  @Test
  void thePasswordIsNeverStoredAsGiven() {
    String id = played(0);
    accounts.register(id, aName(), "correct horse battery");

    String stored = db.sql("select password_hash from account where id = ?")
        .param(id).query(String.class).single();
    assertThat(stored).isNotNull().doesNotContain("correct horse battery");
    // BCrypt, with its cost in the encoding, so the factor can be raised later
    // without invalidating anybody's password.
    assertThat(stored).startsWith("$2");
  }

  @Test
  void twoPeopleWithTheSamePasswordDoNotShareAHash() {
    // A salt, in other words. Without one, the hash column tells an attacker
    // who to attack first.
    String a = played(0);
    String b = played(0);
    accounts.register(a, aName(), "correct horse battery");
    accounts.register(b, aName(), "correct horse battery");

    var hashes = db.sql("select password_hash from account where id in (?, ?)")
        .params(a, b).query(String.class).list();
    assertThat(hashes).doesNotHaveDuplicates();
  }

  @Test
  void loggingInReturnsTheAccountAndASession() {
    String id = played(12);
    String name = aName();
    accounts.register(id, name, "correct horse battery");

    var back = accounts.logIn(name, "correct horse battery");
    assertThat(back.account().id()).isEqualTo(id);
    assertThat(back.account().wins()).isEqualTo(12);
    assertThat(back.refresh()).isNotBlank();
    // A usable session, not just a string that looks like one.
    assertThat(tokens.refresh(back.refresh()).accountId()).isEqualTo(id);
  }

  @Test
  void loggingInDoesNotCareAboutTheCaseOfTheName() {
    String id = played(0);
    String name = aName();
    accounts.register(id, name, "correct horse battery");
    assertThat(accounts.logIn(name.toUpperCase(java.util.Locale.ROOT), "correct horse battery")
        .account().id()).isEqualTo(id);
  }

  @Test
  void aWrongPasswordIsRefused() {
    String name = aName();
    accounts.register(played(0), name, "correct horse battery");
    assertThatThrownBy(() -> accounts.logIn(name, "wrong password"))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void anUnknownNameFailsTheSameWayAsAWrongPassword() {
    // Same exception, so the answer cannot be used to find out which names
    // exist. A different error here is a list of every registered player.
    accounts.register(played(0), aName(), "correct horse battery");
    assertThatThrownBy(() -> accounts.logIn("nobody-at-all", "correct horse battery"))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void aGuestCannotBeLoggedInto() {
    // No username, no password: there is nothing to present.
    played(0);
    assertThatThrownBy(() -> accounts.logIn("", ""))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void registeringLeavesTheDisplayNameAlone() {
    // The name other players see is not the name you log in with, and signing
    // up should not silently rename somebody.
    String id = played(0);
    String before = repository.find(id).orElseThrow().displayName();
    accounts.register(id, aName(), "correct horse battery");
    assertThat(repository.find(id).orElseThrow().displayName()).isEqualTo(before);
  }
}
