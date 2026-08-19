package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** Who is on the other end of this socket. */
class TicketsTest {

  private static RSAKey ours;
  private static RSAKey theirs;

  @BeforeAll
  static void makeKeys() throws Exception {
    ours = new RSAKeyGenerator(2048).keyID("ours").generate();
    theirs = new RSAKeyGenerator(2048).keyID("theirs").generate();
  }

  /** A clock a test can move, so a ticket can expire without a test waiting. */
  private static final class Movable extends Clock {
    private Instant now = Instant.parse("2026-01-01T00:00:00Z");

    void pass(long millis) {
      now = now.plusMillis(millis);
    }

    @Override public Instant instant() {
      return now;
    }

    @Override public ZoneOffset getZone() {
      return ZoneOffset.UTC;
    }

    @Override public Clock withZone(java.time.ZoneId zone) {
      return this;
    }
  }

  private static Tickets tickets(Clock clock) {
    DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
    processor.setJWSKeySelector(new JWSVerificationKeySelector<>(
        JWSAlgorithm.RS256, new ImmutableJWKSet<>(new JWKSet(ours.toPublicJWK()))));
    return new Tickets(processor, clock);
  }

  private static String signed(RSAKey key, JWTClaimsSet claims) throws Exception {
    SignedJWT jwt = new SignedJWT(
        new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
    jwt.sign(new RSASSASigner(key));
    return jwt.serialize();
  }

  private static JWTClaimsSet.Builder claims(String account) {
    return new JWTClaimsSet.Builder()
        .subject(account)
        .jwtID(UUID.randomUUID().toString())
        .expirationTime(Date.from(Instant.now().plusSeconds(60)));
  }

  @Test
  void aRealTicketNamesTheAccountAndTheRosterItWasIssuedFor() throws Exception {
    // The roster travels with the ticket so a client built against a
    // different balance can be refused rather than allowed to play a
    // different game.
    Tickets tickets = tickets(Clock.systemUTC());
    String token = signed(ours, claims("acct_1").claim("cv", "abc123").build());

    Tickets.Ticket ticket = tickets.redeem(token);
    assertThat(ticket.accountId()).isEqualTo("acct_1");
    assertThat(ticket.contentVersion()).isEqualTo("abc123");
  }

  @Test
  void aTicketWithNoRosterIsStillATicket() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    assertThat(tickets.redeem(signed(ours, claims("acct_1").build())).contentVersion())
        .isEmpty();
  }

  @Test
  void aTicketSignedBySomebodyElseIsRefused() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    assertThatThrownBy(() -> tickets.redeem(signed(theirs, claims("acct_1").build())))
        .isInstanceOf(Tickets.BadTicket.class)
        .hasMessage("ticket rejected");
  }

  @Test
  void anExpiredTicketIsRefused() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    String stale = signed(ours, claims("acct_1")
        .expirationTime(Date.from(Instant.now().minusSeconds(300))).build());

    assertThatThrownBy(() -> tickets.redeem(stale))
        .isInstanceOf(Tickets.BadTicket.class);
  }

  @Test
  void somethingThatIsNotATicketAtAllIsRefusedTheSameWay() {
    Tickets tickets = tickets(Clock.systemUTC());
    for (String junk : new String[] {"", "not.a.token", "a.b.c", "null"}) {
      assertThatThrownBy(() -> tickets.redeem(junk))
          .isInstanceOf(Tickets.BadTicket.class)
          .hasMessage("ticket rejected");
    }
  }

  @Test
  void aTicketWithNothingToIdentifyIsRefused() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    // No subject: nobody to be.
    assertThatThrownBy(() -> tickets.redeem(signed(ours, new JWTClaimsSet.Builder()
        .jwtID("j1").expirationTime(Date.from(Instant.now().plusSeconds(60))).build())))
        .isInstanceOf(Tickets.BadTicket.class);
    // No id: nothing to remember, so nothing to stop it being replayed.
    assertThatThrownBy(() -> tickets.redeem(signed(ours, new JWTClaimsSet.Builder()
        .subject("acct_1").expirationTime(Date.from(Instant.now().plusSeconds(60)))
        .build())))
        .isInstanceOf(Tickets.BadTicket.class);
  }

  @Test
  void aTicketIsGoodExactlyOnce() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    String token = signed(ours, claims("acct_1").build());

    assertThat(tickets.redeem(token).accountId()).isEqualTo("acct_1");
    assertThatThrownBy(() -> tickets.redeem(token))
        .isInstanceOf(Tickets.BadTicket.class)
        .hasMessage("ticket already used");
  }

  @Test
  void spentIdsAreForgottenOnceNoTicketCouldStillCarryThem() throws Exception {
    // A few hundred strings, held for as long as a ticket can live -- and no
    // database between two services to hold them in.
    Movable clock = new Movable();
    Tickets tickets = tickets(clock);
    tickets.redeem(signed(ours, claims("acct_1").build()));

    clock.pass(Tickets.REPLAY_WINDOW_MS + 1);
    // Forgetting happens on the next redemption, which is the only time it
    // could matter.
    tickets.redeem(signed(ours, claims("acct_2").build()));
    assertThat(Tickets.REPLAY_WINDOW_MS).isGreaterThan(60_000);
  }

  @Test
  void everySocketGetsItsOwnTicketRatherThanSharingOne() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    for (int i = 0; i < 20; i++) {
      assertThat(tickets.redeem(signed(ours, claims("acct_" + i).build())).accountId())
          .isEqualTo("acct_" + i);
    }
  }

  @Test
  void aFreshProcessDoesNotInheritSpentIds() throws Exception {
    Tickets tickets = tickets(Clock.systemUTC());
    String token = signed(ours, claims("acct_1").build());
    tickets.redeem(token);
    tickets.forgetAllSpent();
    assertThat(tickets.redeem(token).accountId()).isEqualTo("acct_1");
  }
}
