package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Telling the meta tier what happened. */
class ReporterTest {

  private HttpServer server;
  private final AtomicInteger attempts = new AtomicInteger();
  private volatile int reply = 200;
  private volatile String lastBody;
  private volatile String lastKey;

  @BeforeEach
  void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress(0), 0);
    server.createContext("/internal/matches", exchange -> {
      attempts.incrementAndGet();
      lastKey = exchange.getRequestHeaders().getFirst("x-internal-key");
      lastBody = new String(exchange.getRequestBody().readAllBytes());
      exchange.sendResponseHeaders(reply, -1);
      exchange.close();
    });
    server.start();
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  private Reporter reporter() {
    return new Reporter("http://localhost:" + server.getAddress().getPort(), "shared-secret");
  }

  private static Room.Report result() {
    return new Room.Report("m_abc", "team1", "kingDown", 173_000, "c0ffee",
        List.of(new Room.Report.Player("ana", 1, 1), new Room.Report.Player("bo", 2, 1)));
  }

  @Test
  void aResultIsPostedInTheBoardsOwnLanguage() {
    // Teams and seats, not "player" and "enemy" -- those are words about which
    // end of the arena somebody sat at. A 2v2 is this message with four entries.
    try (Reporter reporter = reporter()) {
      assertThat(reporter.send(result())).isTrue();
    }
    assertThat(attempts.get()).isEqualTo(1);
    assertThat(lastBody).contains("\"matchId\":\"m_abc\"").contains("\"outcome\":\"team1\"")
        .contains("\"team\":1").contains("\"team\":2")
        .contains("\"contentVersion\":\"c0ffee\"");
    assertThat(lastKey).isEqualTo("shared-secret");
  }

  @Test
  void aRefusalIsNotRetried() {
    // A 4xx will be refused again, and retrying it just delays the log line
    // that says a result was lost.
    reply = 400;
    try (Reporter reporter = reporter()) {
      assertThat(reporter.send(result())).isTrue();
    }
    assertThat(attempts.get()).isEqualTo(1);
  }

  @Test
  void aFailureIsRetriedAndThenGivenUpOn() {
    // Retrying is safe because reporting is idempotent on matchId: a retry
    // after a timeout that actually succeeded cannot double-count a win.
    reply = 500;
    try (Reporter reporter = reporter()) {
      assertThat(reporter.send(result())).isFalse();
    }
    assertThat(attempts.get()).isEqualTo(Reporter.ATTEMPTS);
  }

  @Test
  void aMetaTierThatIsNotThereDoesNotStopAnything() {
    // The match is finished and the players have their result. This failing
    // must cost them nothing.
    try (Reporter reporter = new Reporter("http://localhost:1", "k")) {
      reporter.report(result());
      assertThat(reporter.unreported()).isNotNegative();
    }
  }

  @Test
  void resultsAreQueuedRatherThanSentOnTheMatchThread() {
    // A three-minute match ends on the tick loop, which is shared by every
    // other match on the node. Nothing here may block it.
    reply = 500;
    try (Reporter reporter = reporter()) {
      long before = System.currentTimeMillis();
      for (int i = 0; i < 20; i++) reporter.report(result());
      assertThat(System.currentTimeMillis() - before).isLessThan(500);
    }
  }

  @Test
  void beingTurnedAwayIsNotTheSameAsBeingRefused() {
    // 401 means this server is misconfigured, not that the match is invalid --
    // and a misconfiguration is a thing that gets *fixed*, so the result is
    // worth holding on to. Treating it as a refusal is how one mismatched
    // property name silently threw away every match result on the node while
    // both services looked perfectly healthy.
    reply = 401;
    try (Reporter reporter = reporter()) {
      assertThat(reporter.send(result())).isFalse();
    }
    assertThat(attempts.get()).isEqualTo(Reporter.ATTEMPTS);
  }
}
