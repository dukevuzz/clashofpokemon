package io.github.excalibase.clashofpokemon.api.web;

import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.JsonNode;
import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.RestClient;

/** The API as a client sees it. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiEndpointsTest {

  @LocalServerPort int port;
  @Autowired RestClient.Builder builder;

  private RestClient client() {
    return builder.baseUrl("http://localhost:" + port).build();
  }

  /** Become a guest, and hold on to what it gives back. */
  private JsonNode signUp() {
    return client().post().uri("/v1/auth/guest").retrieve().body(JsonNode.class);
  }

  private String accessFor(JsonNode guest) {
    return client().post().uri("/v1/auth/refresh")
        .body(Map.of("refresh", guest.get("refresh").asText()))
        .retrieve().body(JsonNode.class).get("access").asText();
  }

  private RestClient asPlayer(String access) {
    return builder.baseUrl("http://localhost:" + port)
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + access).build();
  }

  @Test
  void anyoneCanBecomeAGuest() {
    var guest = signUp();
    assertThat(guest.get("account").get("id").asText()).startsWith("acct_");
    assertThat(guest.get("account").get("guest").asBoolean()).isTrue();
    assertThat(guest.get("refresh").asText()).isNotBlank();
  }

  @Test
  void contentIsPublic() {
    // The client needs the roster before it has an account.
    var content = client().get().uri("/v1/content").retrieve().body(JsonNode.class);
    assertThat(content.get("cards")).hasSize(127);
    assertThat(content.get("version").asText()).isNotBlank();
  }

  @Test
  void meNeedsAToken() {
    var response = client().get().uri("/v1/me")
        .exchange((req, res) -> res.getStatusCode());
    assertThat(response).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void meDescribesTheAccountAndItsDeck() {
    var guest = signUp();
    var me = asPlayer(accessFor(guest)).get().uri("/v1/me")
        .retrieve().body(JsonNode.class);

    assertThat(me.get("account").get("id").asText())
        .isEqualTo(guest.get("account").get("id").asText());
    // Seeded at creation, so a new player can queue immediately.
    assertThat(me.get("deck").get("cards")).hasSize(6);
  }

  @Test
  void aDeckCanBeSavedAndReadBack() {
    var player = asPlayer(accessFor(signUp()));
    var cards = List.of("charmander", "snorlax", "voltorb", "machop", "geodude", "eevee");

    player.put().uri("/v1/me/deck")
        .body(Map.of("cards", cards, "troop", "crobat", "branch", "vaporeon"))
        .retrieve().toBodilessEntity();

    var back = player.get().uri("/v1/me/deck").retrieve().body(JsonNode.class);
    assertThat(back.get("troop").asText()).isEqualTo("crobat");
    assertThat(back.get("cards")).hasSize(6);
  }

  @Test
  void anIllegalDeckIsRefusedAndSaysWhy() {
    var player = asPlayer(accessFor(signUp()));
    var bad = List.of("charmander", "not-a-pokemon", "voltorb", "machop", "geodude", "eevee");

    var response = player.put().uri("/v1/me/deck")
        .body(Map.of("cards", bad, "troop", "togekiss"))
        .exchange((req, res) -> new Object() {
          final HttpStatus status = (HttpStatus) res.getStatusCode();
          final String body = new String(res.getBody().readAllBytes());
        });

    // By number, not by name: 422 is UNPROCESSABLE_ENTITY in older Spring and
    // UNPROCESSABLE_CONTENT in this one, and the client only ever sees the code.
    assertThat(response.status.value()).isEqualTo(422);
    // Naming the card is the whole point: the deck screen has to point at it.
    assertThat(response.body).contains("not-a-pokemon");
  }

  @Test
  void aTicketIsIssuedToAnAuthenticatedPlayer() {
    var ticket = asPlayer(accessFor(signUp())).post().uri("/v1/auth/ticket")
        .retrieve().body(JsonNode.class);
    assertThat(ticket.get("ticket").asText()).isNotBlank();
    assertThat(ticket.get("expiresIn").asLong()).isPositive();
  }

  @Test
  void theGameServerCanFetchThePublicKeys() {
    // Unauthenticated on purpose: it is public key material, and the game
    // server must be able to start without holding a credential of its own.
    var jwks = client().get().uri("/internal/jwks").retrieve().body(JsonNode.class);
    assertThat(jwks.get("keys")).isNotEmpty();
    assertThat(jwks.toString()).doesNotContain("\"d\":");
  }

  @Test
  void theGameServerReportsAMatch() {
    var one = signUp().get("account").get("id").asText();
    var two = signUp().get("account").get("id").asText();

    var report = Map.of(
        "matchId", "m_http_1", "outcome", "team1", "reason", "kingDown",
        "durationMs", 90_000, "contentVersion", "v1",
        "players", List.of(
            Map.of("accountId", one, "team", 1, "seat", 1),
            Map.of("accountId", two, "team", 2, "seat", 1)));

    for (int attempt = 0; attempt < 2; attempt++) {
      var status = client().post().uri("/internal/matches")
          .header("X-Internal-Key", "test-internal-key")
          .body(report)
          .exchange((req, res) -> res.getStatusCode());
      assertThat(status).isEqualTo(HttpStatus.NO_CONTENT);
    }

    // Reported twice, counted once.
    var access = accessFor(signUp());
    var winner = client().get().uri("/v1/users/" + one).retrieve().body(JsonNode.class);
    assertThat(winner.get("wins").asInt()).isEqualTo(1);
    assertThat(access).isNotBlank();
  }

  @Test
  void theInternalRouteRefusesStrangers() {
    var status = client().post().uri("/internal/matches")
        .body(Map.of("matchId", "m_nope"))
        .exchange((req, res) -> res.getStatusCode());
    assertThat(status).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void theBrowserIsAllowedToCallUs() {
    // The client is served from a CDN on another origin. Without this the game
    // cannot talk to its own API at all.
    var headers = client().method(HttpMethod.OPTIONS).uri("/v1/content")
        .header("Origin", "https://clashofpokemon.pages.dev")
        .header("Access-Control-Request-Method", "GET")
        .exchange((req, res) -> res.getHeaders());
    assertThat(headers.getAccessControlAllowOrigin()).isNotNull();
  }
}
