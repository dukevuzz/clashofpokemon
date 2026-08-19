package io.github.excalibase.clashofpokemon.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/** Becoming somebody, and staying them. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class GuestAndTokenTest {

  @Autowired GuestService guests;
  @Autowired TokenService tokens;

  @Test
  void aGuestIsARealAccount() {
    var one = guests.create();
    assertThat(one.account().id()).startsWith("acct_");
    assertThat(one.account().guest()).isTrue();
    assertThat(one.account().displayName()).isNotBlank();
    assertThat(one.refresh()).isNotBlank();
  }

  @Test
  void twoGuestsAreTwoPeople() {
    var a = guests.create();
    var b = guests.create();
    assertThat(a.account().id()).isNotEqualTo(b.account().id());
    assertThat(a.account().displayName()).isNotEqualTo(b.account().displayName());
    assertThat(a.refresh()).isNotEqualTo(b.refresh());
  }

  @Test
  void theAccountIdIsNotACredential() {
    // The whole point. Knowing who somebody is must not let you be them.
    var victim = guests.create();
    assertThatThrownBy(() -> tokens.refresh(victim.account().id()))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void aRefreshTokenBuysAnAccessTokenAndANewRefreshToken() {
    var guest = guests.create();
    var next = tokens.refresh(guest.refresh());

    assertThat(next.access()).isNotBlank();
    assertThat(next.refresh()).isNotEqualTo(guest.refresh());
    assertThat(next.accountId()).isEqualTo(guest.account().id());
  }

  @Test
  void aRefreshTokenWorksExactlyOnce() {
    var guest = guests.create();
    tokens.refresh(guest.refresh());

    assertThatThrownBy(() -> tokens.refresh(guest.refresh()))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void reusingARotatedTokenRevokesTheWholeChain() {
    // Two clients holding one token means it was stolen. Which one is the
    // owner is unknowable, so both are logged out and the real owner signs in
    // again -- an inconvenience, where the alternative is a silent takeover.
    var guest = guests.create();
    var second = tokens.refresh(guest.refresh());
    var third = tokens.refresh(second.refresh());

    // The thief replays the first token...
    assertThatThrownBy(() -> tokens.refresh(guest.refresh()))
        .isInstanceOf(AuthFailed.class);

    // ...and the newest token, held by the real owner, is dead too.
    assertThatThrownBy(() -> tokens.refresh(third.refresh()))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void loggingOutEndsThatChainOnly() {
    var a = guests.create();
    var b = guests.create();
    tokens.logout(a.refresh());

    assertThatThrownBy(() -> tokens.refresh(a.refresh()))
        .isInstanceOf(AuthFailed.class);
    assertThat(tokens.refresh(b.refresh()).access()).isNotBlank();
  }

  @Test
  void anUnknownTokenIsRefused() {
    assertThatThrownBy(() -> tokens.refresh("rt_not-a-real-token"))
        .isInstanceOf(AuthFailed.class);
  }

  @Test
  void anAccessTokenNamesItsAccount() {
    var guest = guests.create();
    var session = tokens.refresh(guest.refresh());
    assertThat(tokens.accountFor(session.access())).isEqualTo(guest.account().id());
  }

  @Test
  void aTamperedAccessTokenIsRefused() {
    var guest = guests.create();
    var session = tokens.refresh(guest.refresh());
    String forged = session.access().substring(0, session.access().length() - 2) + "xy";
    assertThatThrownBy(() -> tokens.accountFor(forged))
        .isInstanceOf(AuthFailed.class);
  }
}
