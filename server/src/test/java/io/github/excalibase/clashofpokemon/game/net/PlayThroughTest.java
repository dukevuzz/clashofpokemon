package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.excalibase.clashofpokemon.game.rules.Rules;
import io.github.excalibase.clashofpokemon.game.rules.Side;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Two clients, one server, a real socket, a real match. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    // Not four minutes: the drain hook waits for matches to finish, and a
    // test that leaves one running would hold the JVM open until it gave up.
    properties = "clash.drain-timeout-ms=2000")
class PlayThroughTest {

  private static final ObjectMapper JSON = JsonMapper.builder().build();
  private static RSAKey key;

  @BeforeAll
  static void makeAKey() throws Exception {
    key = new RSAKeyGenerator(2048).keyID("test").generate();
  }

  /** The meta tier, reduced to the only thing this process needs from it: a public key. */
  @TestConfiguration
  static class SignedByUs {
    @Bean
    @Primary
    Tickets tickets() {
      DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
      processor.setJWSKeySelector(new JWSVerificationKeySelector<>(
          JWSAlgorithm.RS256, new ImmutableJWKSet<>(new JWKSet(key.toPublicJWK()))));
      return new Tickets(processor, Clock.systemUTC());
    }
  }

  private static String ticketFor(String account) throws Exception {
    JWTClaimsSet claims = new JWTClaimsSet.Builder()
        .subject(account)
        .jwtID(UUID.randomUUID().toString())
        .claim("cv", io.github.excalibase.clashofpokemon.game.rules.Cards.version())
        .expirationTime(Date.from(Instant.now().plusSeconds(60)))
        .build();
    SignedJWT jwt = new SignedJWT(
        new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
    jwt.sign(new RSASSASigner(key));
    return jwt.serialize();
  }

  @org.springframework.beans.factory.annotation.Value("${local.server.port}")
  private int port;

  @Autowired
  private Matchmaker matchmaker;

  /** Wait for the last test's sockets to actually be gone. */
  @org.junit.jupiter.api.BeforeEach
  void waitForAnEmptyQueue() throws Exception {
    long deadline = System.currentTimeMillis() + 5000;
    while (matchmaker.queued() > 0 && System.currentTimeMillis() < deadline) {
      Thread.sleep(20);
    }
    assertThat(matchmaker.queued()).as("queue left dirty by an earlier test").isZero();
  }

  /** One connected client, and everything the server has said to it. */
  private final class Client extends AbstractWebSocketHandler implements AutoCloseable {
    private final WebSocketSession session;
    private final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
    private final BlockingQueue<byte[]> frames = new LinkedBlockingQueue<>();

    Client() throws Exception {
      this("/play");
    }

    Client(String path) throws Exception {
      session = new StandardWebSocketClient()
          .execute(this, "ws://localhost:" + port + path).get(5, TimeUnit.SECONDS);
    }

    @Override protected void handleTextMessage(WebSocketSession s, TextMessage m) {
      messages.add(JSON.readTree(m.getPayload()));
    }

    @Override protected void handleBinaryMessage(WebSocketSession s, BinaryMessage m) {
      byte[] bytes = new byte[m.getPayload().remaining()];
      m.getPayload().get(bytes);
      frames.add(bytes);
    }

    void send(String json) throws Exception {
      session.sendMessage(new TextMessage(json));
    }

    void auth(String account, String extra) throws Exception {
      send("{\"t\":\"auth\",\"ticket\":\"" + ticketFor(account) + "\",\"deck\":" + deckJson()
          + ",\"troop\":\"" + Rules.troops().getFirst().id() + "\"" + extra + "}");
    }

    /** Did a message of this kind arrive shortly? Used to assert one did not. */
    boolean sawMessage(String type) throws Exception {
      long deadline = System.currentTimeMillis() + 500;
      while (System.currentTimeMillis() < deadline) {
        JsonNode m = messages.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
        if (m == null) break;
        if (type.equals(m.get("t").stringValue())) return true;
      }
      return false;
    }

    /** Did this socket ever hear this refusal? Waits a moment for it to arrive. */
    boolean sawError(String contains) {
      try {
        awaitError(contains);
        return true;
      } catch (Exception | AssertionError e) {
        return false;
      }
    }

    /** The next error whose message is the one expected, ignoring earlier ones. */
    void awaitError(String contains) throws Exception {
      List<String> saw = new ArrayList<>();
      long deadline = System.currentTimeMillis() + 5000;
      while (System.currentTimeMillis() < deadline) {
        JsonNode m = messages.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
        if (m == null) break;
        if (!"error".equals(m.get("t").stringValue())) continue;
        String message = m.get("message").stringValue();
        if (message.contains(contains)) return;
        saw.add(message);
      }
      throw new AssertionError("waited for an error containing \"" + contains
          + "\", saw " + saw);
    }

    /** The next message of this kind, or a failure that says what did arrive. */
    JsonNode await(String type) throws Exception {
      List<String> saw = new ArrayList<>();
      long deadline = System.currentTimeMillis() + 5000;
      while (System.currentTimeMillis() < deadline) {
        JsonNode m = messages.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
        if (m == null) break;
        if (type.equals(m.get("t").stringValue())) return m;
        saw.add(m.get("t").stringValue());
      }
      throw new AssertionError("waited for " + type + ", saw " + saw);
    }

    byte[] awaitFrame() throws Exception {
      byte[] f = frames.poll(5, TimeUnit.SECONDS);
      assertThat(f).as("a packed snapshot").isNotNull();
      return f;
    }

    @Override public void close() throws Exception {
      if (session.isOpen()) session.close(CloseStatus.NORMAL);
    }
  }

  /** A deck of cards that can simply be played. */
  private static String deckJson() {
    List<String> deck = io.github.excalibase.clashofpokemon.game.rules.Cards.all().stream()
        .map(io.github.excalibase.clashofpokemon.game.rules.Card::id)
        .filter(id -> !"ditto".equals(id))
        .limit(Rules.config().deckSize()).toList();
    return "[\"" + String.join("\",\"", deck) + "\"]";
  }

  // -------------------------------------------------------------------------

  @Test
  void twoPlayersConnectAndPlayAMatch() throws Exception {
    try (Client ana = new Client(); Client bo = new Client()) {
      ana.auth("acct_" + UUID.randomUUID(), "");
      bo.auth("acct_" + UUID.randomUUID(), "");

      // The greeting carries both decks -- which is what makes the loading
      // gate possible at all. A client told them only at `start` would have
      // nothing to load and would never report ready.
      JsonNode hello = ana.await("hello");
      assertThat(hello.get("v").intValue()).isEqualTo(Protocol.VERSION);
      assertThat(hello.get("me").get("deck")).hasSize(Rules.config().deckSize());
      assertThat(hello.get("them").get("deck")).hasSize(Rules.config().deckSize());
      assertThat(bo.await("hello").get("seat").intValue())
          .isNotEqualTo(hello.get("seat").intValue());

      // Nothing starts until both say their art is ready.
      ana.send("{\"t\":\"loaded\"}");
      bo.send("{\"t\":\"loaded\"}");
      assertThat(ana.await("start").get("seed")).isNotNull();
      assertThat(bo.await("start")).isNotNull();

      // And then the board arrives, packed, fifteen times a second.
      Snapshot.Snap snap = Snapshot.decode(ana.awaitFrame());
      assertThat(snap.towers()).hasSize(6);
      assertThat(snap.me().hand()).hasSize(Rules.config().handSize());
      assertThat(snap.me().elixir()).isPositive();
    }
  }

  @Test
  void aPlayCrossesTheWireAndPutsSomethingOnBothBoards() throws Exception {
    try (Client ana = new Client(); Client bo = new Client()) {
      ana.auth("acct_" + UUID.randomUUID(), "");
      bo.auth("acct_" + UUID.randomUUID(), "");
      JsonNode hello = ana.await("hello");
      bo.await("hello");
      ana.send("{\"t\":\"loaded\"}");
      bo.send("{\"t\":\"loaded\"}");
      ana.await("start");
      bo.await("start");

      // Wait for the elixir by reading the snapshots, rather than sleeping a guessed number of milliseconds.
      Snapshot.Snap snap;
      do {
        snap = Snapshot.decode(ana.awaitFrame());
      } while (snap.me().elixir()
          < io.github.excalibase.clashofpokemon.game.rules.Cards.byId(snap.me().hand().getFirst()).elixir());

      // Into our own half -- whichever half that is, since seats are random.
      boolean bottom = hello.get("seat").intValue() == Side.ONE.wire();
      double y = bottom ? Rules.config().arenaHeight() - 90 : 90;
      ana.send("{\"t\":\"deploy\",\"seq\":1,\"slot\":0,\"x\":144,\"y\":" + y + "}");

      // The opponent sees it too: the board is public, only the hand is not.
      JsonNode ev = bo.await("ev");
      assertThat(ev.get("e").valueStream().map(e -> e.get("e").stringValue()).toList())
          .contains("spawn");
      // And nothing was refused on the way -- a reject here would mean the
      // rules disagreed, which is a different bug from the wire dropping it.
      assertThat(ana.sawMessage("reject")).isFalse();
    }
  }

  @Test
  void aSecondTabIsTurnedAwayRatherThanTakingOverTheSeat() throws Exception {
    // Every tab of a profile shares local storage, so a second tab is the same
    // person twice -- and the first connection wins, or a stray tab could
    // knock somebody out of a live match.
    String account = "acct_" + UUID.randomUUID();
    try (Client first = new Client(); Client second = new Client()) {
      first.auth(account, "");
      second.auth(account, "");

      // Which tab wins is not asserted -- the first connection wins, but
      // "first" here means whichever frame the server read first, and two
      // sockets opened a millisecond apart do not arrive in a guaranteed
      // order. That exactly one is refused is the property, and asserting it
      // this way is what exposed the account being claimed non-atomically.
      long refused = java.util.stream.Stream.of(first, second)
          .filter(c -> c.sawError("another tab")).count();
      assertThat(refused).isEqualTo(1);
    }
  }

  @Test
  void aForgedTicketGetsNowhere() throws Exception {
    try (Client fake = new Client()) {
      fake.send("{\"t\":\"auth\",\"ticket\":\"not.a.ticket\",\"deck\":" + deckJson() + "}");
      assertThat(fake.await("error").get("message").stringValue()).isEqualTo("ticket rejected");
    }
  }

  @Test
  void aTicketIsGoodExactlyOnce() throws Exception {
    // Which of the two wins the race is not the point and is not asserted --
    // that exactly one of them does is.
    String ticket = ticketFor("acct_" + UUID.randomUUID());
    try (Client once = new Client(); Client twice = new Client()) {
      once.send("{\"t\":\"auth\",\"ticket\":\"" + ticket + "\",\"deck\":" + deckJson() + "}");
      twice.send("{\"t\":\"auth\",\"ticket\":\"" + ticket + "\",\"deck\":" + deckJson() + "}");

      long refused = java.util.stream.Stream.of(once, twice)
          .filter(c -> c.sawError("ticket already used")).count();
      assertThat(refused).isEqualTo(1);
    }
  }

  @Test
  void aDeckOfEvolvedCardsIsRefusedAtTheDoor() throws Exception {
    try (Client cheat = new Client()) {
      cheat.send("{\"t\":\"auth\",\"ticket\":\"" + ticketFor("acct_" + UUID.randomUUID())
          + "\",\"deck\":[\"charizard\",\"blastoise\",\"machamp\",\"golem\",\"gengar\",\"alakazam\"]}");
      assertThat(cheat.await("error").get("message").stringValue())
          .contains("allowed to choose");
    }
  }

  @Test
  void aFriendCanBeInvitedByCode() throws Exception {
    try (Client host = new Client(); Client guest = new Client()) {
      host.auth("acct_" + UUID.randomUUID(), ",\"invite\":{\"create\":true}");
      String code = host.await("invite").get("code").stringValue();
      assertThat(code).hasSize(Protocol.INVITE_LENGTH);

      guest.auth("acct_" + UUID.randomUUID(), ",\"invite\":{\"code\":\"" + code + "\"}");
      assertThat(host.await("hello")).isNotNull();
      assertThat(guest.await("hello")).isNotNull();
    }
  }

  @Test
  void aCodeNobodyOpenedIsRefused() throws Exception {
    try (Client guest = new Client()) {
      guest.auth("acct_" + UUID.randomUUID(), ",\"invite\":{\"code\":\"ZZZZZ\"}");
      assertThat(guest.await("error").get("message").stringValue())
          .isEqualTo("no room with that code");
    }
  }

  @Test
  void theClientsOwnAddressWorks() throws Exception {
    // The built client opens `ws://host:4400` with no path. Everything else
    // here uses `/play`, so without this the one address that matters in
    // production is the one address nothing tests.
    try (Client root = new Client("")) {
      root.send("{\"t\":\"deploy\",\"seq\":1,\"slot\":0,\"x\":100,\"y\":600}");
      assertThat(root.await("error").get("message").stringValue()).isEqualTo("auth first");
    }
  }

  @Test
  void aMessageThatIsNotJsonIsAnsweredRatherThanCrashing() throws Exception {
    try (Client noise = new Client()) {
      noise.send("<not json at all>");
      assertThat(noise.await("error").get("message").stringValue()).isEqualTo("not json");
    }
  }

  @Test
  void anythingBeforeAuthIsRefused() throws Exception {
    try (Client early = new Client()) {
      early.send("{\"t\":\"deploy\",\"seq\":1,\"slot\":0,\"x\":100,\"y\":600}");
      assertThat(early.await("error").get("message").stringValue()).isEqualTo("auth first");
    }
  }

  @Test
  void aFloodIsRefusedBeforeItIsRead() throws Exception {
    // The guard runs on the raw frame. A limit that runs after the parse has
    // already paid for the parse, which is what the flood was buying.
    try (Client loud = new Client()) {
      for (int i = 0; i < Limits.MAX_PER_WINDOW + 5; i++) {
        loud.send("{\"t\":\"ping\",\"c\":" + i + "}");
      }
      // Every unauthenticated frame draws an "auth first" first, which is the
      // guard *after* this one. The flood is refused regardless of what the
      // frames were, which is the property that matters.
      loud.awaitError("too many messages");
    }
  }

  @Test
  void theStatusPageCountsRatherThanLists() throws Exception {
    // An earlier version listed every live match with its id, to anybody.
    var client = java.net.http.HttpClient.newHttpClient();
    var res = client.send(
        java.net.http.HttpRequest.newBuilder(
            URI.create("http://localhost:" + port + "/status")).build(),
        java.net.http.HttpResponse.BodyHandlers.ofString());

    JsonNode body = JSON.readTree(res.body());
    assertThat(res.statusCode()).isEqualTo(200);
    assertThat(body.get("ok").booleanValue()).isTrue();
    assertThat(body.has("queued")).isTrue();
    assertThat(body.has("matches")).isTrue();
    assertThat(body.toString()).doesNotContain("m_");
  }

  @Test
  void theBrowserCanReachTheTwoEndpointsItNeeds() throws Exception {
    // The client is served from another origin -- a CDN in production, Vite on
    // another port in development -- so without these headers the browser
    // blocks the response and PLAY ONLINE never appears. The server answers
    // perfectly the whole time, which is why nothing else noticed.
    var client = java.net.http.HttpClient.newHttpClient();
    for (String path : new String[] {"/status", "/me/match?account=nobody"}) {
      var res = client.send(java.net.http.HttpRequest.newBuilder(
              URI.create("http://localhost:" + port + path))
          .header("Origin", "https://play.example.com").build(),
          java.net.http.HttpResponse.BodyHandlers.ofString());

      assertThat(res.statusCode()).as("%s", path).isEqualTo(200);
      assertThat(res.headers().firstValue("access-control-allow-origin"))
          .as("%s is unreachable from a browser without this", path)
          .isPresent();
    }
  }

  @Test
  void anAccountInNoMatchIsToldSoRatherThanNothing() throws Exception {
    var client = java.net.http.HttpClient.newHttpClient();
    var res = client.send(java.net.http.HttpRequest.newBuilder(
            URI.create("http://localhost:" + port + "/me/match?account=nobody")).build(),
        java.net.http.HttpResponse.BodyHandlers.ofString());

    assertThat(JSON.readTree(res.body()).get("match").isNull()).isTrue();
  }

  @Test
  void aPlayerInAMatchIsToldHowLongIsLeft() throws Exception {
    // What the menu shows as "a match is still running -- 45s left", so a
    // refresh offers the way back instead of leaving somebody watching their
    // towers fall from the main menu.
    String account = "acct_" + UUID.randomUUID();
    try (Client ana = new Client(); Client bo = new Client()) {
      ana.auth(account, "");
      bo.auth("acct_" + UUID.randomUUID(), "");
      ana.await("hello");
      bo.await("hello");

      var client = java.net.http.HttpClient.newHttpClient();
      var res = client.send(java.net.http.HttpRequest.newBuilder(
              URI.create("http://localhost:" + port + "/me/match?account=" + account)).build(),
          java.net.http.HttpResponse.BodyHandlers.ofString());

      JsonNode match = JSON.readTree(res.body()).get("match");
      assertThat(match.isNull()).as("this account is in a match").isFalse();
      assertThat(match.get("left").intValue()).isPositive();
    }
  }

  @Test
  void abranchIsAnsweredOnceAndCannotBeSwitched() throws Exception {
    // The one decision in the game that cannot be taken back, over the wire.
    String anaId = "acct_" + UUID.randomUUID();
    try (Client one = new Client(); Client two = new Client()) {
      one.auth(anaId, "");
      two.auth("acct_" + UUID.randomUUID(), "");
      one.await("hello");
      two.await("hello");
      one.send("{\"t\":\"loaded\"}");
      two.send("{\"t\":\"loaded\"}");
      one.await("start");
      two.await("start");

      // Raise a real offer in the running match rather than playing Eevee
      // three times down a socket: what is under test is the answer, not the
      // arithmetic that leads to one.
      var seated = matchmaker.seatOf(anaId);
      assertThat(seated).as("ana should be seated").isNotNull();
      var room = seated.room();
      var side = seated.side();

      var eevee = io.github.excalibase.clashofpokemon.game.rules.Cards.all().stream()
          .filter(c -> io.github.excalibase.clashofpokemon.game.rules.Evolution
              .offerFor(c.id(), room.match.rng) != null)
          .findFirst().orElse(null);
      org.junit.jupiter.api.Assumptions.assumeTrue(eevee != null, "no branching card");

      for (int i = 0; i < io.github.excalibase.clashofpokemon.game.rules.Evolution.playsNeeded(eevee); i++) {
        room.match.hand.get(side).set(0, eevee);
        room.match.elixir.put(side, 10.0);
        room.match.deploy(side, 0, 144, side == Side.ONE ? 560 : 110);
      }

      var offer = room.match.pendingChoice.get(side);
      assertThat(offer).as("an offer should be waiting").isNotNull();
      String chosen = offer.options().getFirst().id();
      String other = offer.options().get(1).id();

      // Answered, and then answered again with a different branch.
      one.send("{\"t\":\"choose\",\"seq\":1,\"choiceId\":\"" + offer.id()
          + "\",\"cardId\":\"" + chosen + "\"}");
      one.send("{\"t\":\"choose\",\"seq\":2,\"choiceId\":\"" + offer.id()
          + "\",\"cardId\":\"" + other + "\"}");

      JsonNode refused = one.await("reject");
      assertThat(refused.get("seq").intValue()).as("the *second* answer is the refused one")
          .isEqualTo(2);
      assertThat(refused.get("code").stringValue()).isEqualTo("stale");

      // And the branch not chosen never appears anywhere -- not in the hand,
      // not in the cycle. (The offer here was staged into the hand rather
      // than reached by play, so the *chosen* card may already have been
      // drawn over; what matters is that switching bought nothing.)
      List<String> held = new java.util.ArrayList<>();
      for (var c : room.match.hand.get(side)) held.add(c == null ? null : c.id());
      for (var c : room.match.deck.get(side)) held.add(c.id());

      assertThat(held).as("the branch that was refused").doesNotContain(other);
      assertThat(room.match.pendingChoice.get(side))
          .as("the offer is spent, not still open").isNull();
    }
  }

  @Test
  void aBranchThatWasNeverOfferedIsRefusedOverTheWire() throws Exception {
    String anaId = "acct_" + UUID.randomUUID();
    try (Client one = new Client(); Client two = new Client()) {
      one.auth(anaId, "");
      two.auth("acct_" + UUID.randomUUID(), "");
      one.await("hello");
      two.await("hello");
      one.send("{\"t\":\"loaded\"}");
      two.send("{\"t\":\"loaded\"}");
      one.await("start");
      two.await("start");

      var seated = matchmaker.seatOf(anaId);
      var room = seated.room();
      var side = seated.side();

      var eevee = io.github.excalibase.clashofpokemon.game.rules.Cards.all().stream()
          .filter(c -> io.github.excalibase.clashofpokemon.game.rules.Evolution
              .offerFor(c.id(), room.match.rng) != null)
          .findFirst().orElse(null);
      org.junit.jupiter.api.Assumptions.assumeTrue(eevee != null, "no branching card");

      for (int i = 0; i < io.github.excalibase.clashofpokemon.game.rules.Evolution.playsNeeded(eevee); i++) {
        room.match.hand.get(side).set(0, eevee);
        room.match.elixir.put(side, 10.0);
        room.match.deploy(side, 0, 144, side == Side.ONE ? 560 : 110);
      }
      var offer = room.match.pendingChoice.get(side);
      assertThat(offer).isNotNull();

      List<String> offered = offer.options().stream()
          .map(io.github.excalibase.clashofpokemon.game.rules.Card::id).toList();
      // A branch this card can become, drawn from a *different* offer, so it
      // is a real eeveelution and not merely an unknown card id -- the point
      // is that it was not on the table this time.
      String greedy = null;
      for (int tries = 0; tries < 20 && greedy == null; tries++) {
        for (String id : io.github.excalibase.clashofpokemon.game.rules.Evolution
            .offerFor(eevee.id(), room.match.rng)) {
          if (!offered.contains(id)) { greedy = id; break; }
        }
      }
      org.junit.jupiter.api.Assumptions.assumeTrue(greedy != null, "all branches offered");

      one.send("{\"t\":\"choose\",\"seq\":9,\"choiceId\":\"" + offer.id()
          + "\",\"cardId\":\"" + greedy + "\"}");

      assertThat(one.await("reject").get("code").stringValue()).isEqualTo("stale");
      // The offer is still open, so nothing was spent by trying.
      assertThat(room.match.pendingChoice.get(side)).isNotNull();
    }
  }
}
