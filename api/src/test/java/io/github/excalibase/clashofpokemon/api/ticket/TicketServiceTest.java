package io.github.excalibase.clashofpokemon.api.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.time.Duration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The one credential the game server ever sees. */
class TicketServiceTest {

  static TicketService tickets;
  static TicketVerifier verifier;

  @BeforeAll
  static void setUp() {
    var keys = TicketKeys.generate();
    tickets = new TicketService(keys, new ContentService());
    // Standing in for the game server: it holds only the public half.
    verifier = new TicketVerifier(keys.publicJwks());
  }

  @Test
  void aTicketNamesItsAccount() {
    var ticket = tickets.issue("acct_abc");
    assertThat(verifier.verify(ticket.token()).accountId()).isEqualTo("acct_abc");
  }

  @Test
  void aTicketIsShortLived() {
    assertThat(tickets.issue("acct_abc").expiresIn())
        .isLessThanOrEqualTo(Duration.ofMinutes(1).toSeconds());
  }

  @Test
  void eachTicketHasItsOwnId() {
    // The game server keeps spent ids for the ticket's lifetime. Reusing an id
    // would make one player's second connection look like a replay of another.
    var a = verifier.verify(tickets.issue("acct_abc").token());
    var b = verifier.verify(tickets.issue("acct_abc").token());
    assertThat(a.id()).isNotEqualTo(b.id());
  }

  @Test
  void aTicketCarriesTheContentVersion() {
    // A client built against a different roster is refused at the door rather
    // than allowed into a match where the two disagree about what a card is.
    var claims = verifier.verify(tickets.issue("acct_abc").token());
    assertThat(claims.contentVersion()).isEqualTo(new ContentService().version());
  }

  @Test
  void aTamperedTicketIsRefused() {
    String token = tickets.issue("acct_abc").token();
    String forged = token.substring(0, token.length() - 3) + "aaa";
    assertThatThrownBy(() -> verifier.verify(forged))
        .isInstanceOf(BadTicket.class);
  }

  @Test
  void aTicketFromAnotherKeyIsRefused() {
    // The whole point of publishing only the public half.
    var impostor = new TicketService(TicketKeys.generate(), new ContentService());
    assertThatThrownBy(() -> verifier.verify(impostor.issue("acct_abc").token()))
        .isInstanceOf(BadTicket.class);
  }

  @Test
  void anExpiredTicketIsRefused() throws Exception {
    var shortLived = new TicketService(
        TicketKeys.generate(), new ContentService(), Duration.ofMillis(1));
    var verify = new TicketVerifier(shortLived.keys().publicJwks());
    String token = shortLived.issue("acct_abc").token();
    Thread.sleep(1100);   // JOSE expiry has second granularity
    assertThatThrownBy(() -> verify.verify(token)).isInstanceOf(BadTicket.class);
  }

  @Test
  void theJwksPublishesOnlyThePublicHalf() {
    String jwks = TicketKeys.generate().publicJwks();
    assertThat(jwks).contains("\"kty\":\"RSA\"").contains("\"n\":");
    // "d" is the private exponent. Publishing it would hand out the ability to
    // mint tickets for any account.
    assertThat(jwks).doesNotContain("\"d\":");
  }
}
