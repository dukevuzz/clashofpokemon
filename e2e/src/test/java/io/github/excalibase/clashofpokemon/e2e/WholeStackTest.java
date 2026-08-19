package io.github.excalibase.clashofpokemon.e2e;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** The whole thing, from being nobody to having a record. */
class WholeStackTest {

  private static final ObjectMapper JSON = JsonMapper.builder().build();
  private static final HttpClient HTTP = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(5)).build();

  private static Stack stack;

  @BeforeAll
  static void boot() throws Exception {
    stack = new Stack();
  }

  @AfterAll
  static void shutDown() {
    if (stack != null) stack.close();
  }

  // ---------------------------------------------------------------- the api

  private static JsonNode api(String method, String path, String body, String bearer)
      throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://localhost:" + stack.apiPort + path))
        .timeout(Duration.ofSeconds(10))
        .header("content-type", "application/json");
    if (bearer != null) request.header("authorization", "Bearer " + bearer);
    request.method(method, body == null
        ? HttpRequest.BodyPublishers.noBody()
        : HttpRequest.BodyPublishers.ofString(body));

    HttpResponse<String> res = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
    assertThat(res.statusCode())
        .as("%s %s said %s%n%s", method, path, res.body(), stack.tail())
        .isLessThan(400);
    return res.body().isBlank() ? JSON.nullNode() : JSON.readTree(res.body());
  }

  /** Become somebody, exactly as the client does. */
  private record Player(String accountId, String access) {}

  private static Player signUp() throws Exception {
    JsonNode created = api("POST", "/v1/auth/guest", null, null);
    String refresh = created.get("refresh").stringValue();
    String accountId = created.get("account").get("id").stringValue();

    JsonNode session = api("POST", "/v1/auth/refresh",
        "{\"refresh\":\"" + refresh + "\"}", null);
    assertThat(session.get("accountId").stringValue()).isEqualTo(accountId);

    return new Player(accountId, session.get("access").stringValue());
  }

  private static String ticketFor(Player who) throws Exception {
    return api("POST", "/v1/auth/ticket", null, who.access()).get("ticket").stringValue();
  }

  // ------------------------------------------------------------- the socket

  private static final class Client extends AbstractWebSocketHandler implements AutoCloseable {
    private final WebSocketSession session;
    private final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
    private final BlockingQueue<byte[]> frames = new LinkedBlockingQueue<>();

    Client() throws Exception {
      session = new StandardWebSocketClient()
          .execute(this, "ws://localhost:" + stack.gamePort + "/play")
          .get(10, TimeUnit.SECONDS);
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

    /** Did this socket hear this refusal? Waits a moment for it to arrive. */
    boolean sawError(String message) {
      long deadline = System.currentTimeMillis() + 5000;
      try {
        while (System.currentTimeMillis() < deadline) {
          JsonNode m = messages.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
          if (m == null) return false;
          if ("error".equals(m.get("t").stringValue())
              && m.get("message").stringValue().contains(message)) {
            return true;
          }
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      return false;
    }

    JsonNode await(String type) throws Exception {
      List<String> saw = new ArrayList<>();
      long deadline = System.currentTimeMillis() + 20_000;
      while (System.currentTimeMillis() < deadline) {
        JsonNode m = messages.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
        if (m == null) break;
        if (type.equals(m.get("t").stringValue())) return m;
        saw.add(m.toString());
      }
      throw new AssertionError("waited for " + type + ", saw " + saw + stack.tail());
    }

    @Override public void close() throws Exception {
      if (session.isOpen()) session.close(CloseStatus.NORMAL);
    }
  }

  /** Six cards a deck is allowed to hold, read from the roster the api serves. */
  private static String deckJson() throws Exception {
    JsonNode content = api("GET", "/v1/content", null, null);
    List<String> deck = new ArrayList<>();
    for (JsonNode card : content.get("cards")) {
      String id = card.get("id").stringValue();
      // Ditto's cost is whatever it last copied, so it cannot be played from
      // an opening hand. Fine in a deck, useless in a test that plays a card.
      if (!"ditto".equals(id)) deck.add(id);
      if (deck.size() == content.get("rules").get("deckSize").intValue()) break;
    }
    return "[\"" + String.join("\",\"", deck) + "\"]";
  }

  private static void auth(Client client, Player who) throws Exception {
    client.send("{\"t\":\"auth\",\"ticket\":\"" + ticketFor(who)
        + "\",\"deck\":" + deckJson() + "}");
  }

  // -------------------------------------------------------------------------

  @Test
  void aGuestSignsUpPlaysAMatchAndEndsUpWithARecord() throws Exception {
    Player ana = signUp();
    Player bo = signUp();

    try (Client one = new Client(); Client two = new Client()) {
      auth(one, ana);
      auth(two, bo);

      // The ticket was signed by the meta tier and verified by the game
      // server against a key it fetched over HTTP. Nothing stubbed.
      JsonNode hello = one.await("hello");
      assertThat(hello.get("you").stringValue()).isEqualTo(ana.accountId());
      assertThat(two.await("hello").get("you").stringValue()).isEqualTo(bo.accountId());

      one.send("{\"t\":\"loaded\"}");
      two.send("{\"t\":\"loaded\"}");
      one.await("start");
      two.await("start");

      // One player leaves, which ends the match immediately and sends the
      // result on its way to the meta tier.
      two.send("{\"t\":\"leave\"}");
      assertThat(one.await("over").get("youWon").booleanValue()).isTrue();
    }

    // The report crosses back over HTTP, with the internal key, into Postgres.
    JsonNode record = eventually(() -> api("GET", "/v1/users/" + ana.accountId(), null, null),
        node -> node.get("wins").intValue() == 1);
    assertThat(record.get("wins").intValue()).isEqualTo(1);
    assertThat(record.get("losses").intValue()).isZero();

    JsonNode loser = api("GET", "/v1/users/" + bo.accountId(), null, null);
    assertThat(loser.get("losses").intValue()).isEqualTo(1);
  }

  @Test
  void theMatchAppearsInBothPlayersHistoryWithTheReasonItEnded() throws Exception {
    Player ana = signUp();
    Player bo = signUp();

    try (Client one = new Client(); Client two = new Client()) {
      auth(one, ana);
      auth(two, bo);
      one.await("hello");
      two.await("hello");
      one.send("{\"t\":\"loaded\"}");
      two.send("{\"t\":\"loaded\"}");
      one.await("start");
      two.await("start");
      one.send("{\"t\":\"leave\"}");
      two.await("over");
    }

    JsonNode history = eventually(
        () -> api("GET", "/v1/me/matches", null, bo.access()),
        node -> node.size() == 1);

    JsonNode played = history.get(0);
    assertThat(played.get("won").booleanValue()).isTrue();
    // The enum spelling, all the way from Room.report() through JSON, through
    // a check constraint, into Postgres and back out again.
    assertThat(played.get("reason").stringValue()).isEqualTo("forfeit");
    assertThat(played.get("drawn").booleanValue()).isFalse();
  }

  @Test
  void eachSeatIsToldWhoTheyAreAndWhoTheyAreAgainst() throws Exception {
    // The account travels inside the ticket's signature. There is no field in
    // the auth message naming who you are, so there is nothing to lie in --
    // and the name each player sees for the other came from the meta tier,
    // not from the opponent's own client.
    Player ana = signUp();
    Player bo = signUp();

    try (Client one = new Client(); Client two = new Client()) {
      auth(one, ana);
      auth(two, bo);

      JsonNode hers = one.await("hello");
      JsonNode his = two.await("hello");

      assertThat(hers.get("you").stringValue()).isEqualTo(ana.accountId());
      assertThat(hers.get("them").get("id").stringValue()).isEqualTo(bo.accountId());
      assertThat(his.get("you").stringValue()).isEqualTo(bo.accountId());
      assertThat(his.get("them").get("id").stringValue()).isEqualTo(ana.accountId());
      assertThat(hers.get("seat").intValue()).isNotEqualTo(his.get("seat").intValue());
    }
  }

  @Test
  void theGameServerRefusesATicketItWasNotGiven() throws Exception {
    try (Client client = new Client()) {
      client.send("{\"t\":\"auth\",\"ticket\":\"not.a.real.ticket\",\"deck\":"
          + deckJson() + "}");
      assertThat(client.await("error").get("message").stringValue())
          .isEqualTo("ticket rejected");
    }
  }

  @Test
  void aTicketCannotBeSpentTwiceEvenAcrossTwoSockets() throws Exception {
    Player ana = signUp();
    String ticket = ticketFor(ana);
    String deck = deckJson();

    try (Client first = new Client(); Client second = new Client()) {
      first.send("{\"t\":\"auth\",\"ticket\":\"" + ticket + "\",\"deck\":" + deck + "}");
      // No `hello` to wait for: one player is a queue, not a match. What the
      // first socket gets is silence, which is the correct outcome and the
      // reason this waits for the *second* socket instead.
      second.send("{\"t\":\"auth\",\"ticket\":\"" + ticket + "\",\"deck\":" + deck + "}");

      // Which of the two wins the race is not the point and is not asserted.
      // That exactly one of them does is: zero would mean a ticket can be
      // replayed, and two would mean neither player got in.
      long refused = java.util.stream.Stream.of(first, second)
          .filter(c -> c.sawError("ticket already used")).count();
      assertThat(refused).isEqualTo(1);
    }
  }

  @Test
  void bothTiersAgreeOnWhichRosterTheyAreRunning() throws Exception {
    // A client built against a different balance can be turned away at the
    // door -- but only if the two services agree on what the door says.
    JsonNode content = api("GET", "/v1/content", null, null);
    HttpResponse<String> status = HTTP.send(
        HttpRequest.newBuilder(URI.create("http://localhost:" + stack.gamePort + "/status")).build(),
        HttpResponse.BodyHandlers.ofString());

    assertThat(JSON.readTree(status.body()).get("content").stringValue())
        .isEqualTo(content.get("version").stringValue());
  }

  /** Reporting is asynchronous, so the answer is "soon", not "now". */
  private static JsonNode eventually(Attempt attempt, java.util.function.Predicate<JsonNode> done)
      throws Exception {
    JsonNode last = null;
    long deadline = System.currentTimeMillis() + 15_000;
    while (System.currentTimeMillis() < deadline) {
      last = attempt.get();
      if (done.test(last)) return last;
      Thread.sleep(250);
    }
    throw new AssertionError("never happened; last was " + last + stack.tail());
  }

  private interface Attempt {
    JsonNode get() throws Exception;
  }
}
