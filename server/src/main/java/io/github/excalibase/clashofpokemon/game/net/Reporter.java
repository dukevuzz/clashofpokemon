package io.github.excalibase.clashofpokemon.game.net;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Telling the meta tier what happened. */
@Component
public class Reporter implements AutoCloseable {

  private static final Logger log = LoggerFactory.getLogger(Reporter.class);
  private static final ObjectMapper JSON = JsonMapper.builder().build();

  /** How long to keep trying, and how quickly to back off. */
  static final int ATTEMPTS = 6;
  static final long FIRST_DELAY_MS = 500;

  /** Bounded, because an unbounded queue in front of a dead service is a slow way to run out of memory. */
  static final int MAX_PENDING = 10_000;

  private final BlockingQueue<Room.Report> pending = new ArrayBlockingQueue<>(MAX_PENDING);
  private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
    Thread t = new Thread(r, "match-reporter");
    t.setDaemon(true);
    return t;
  });

  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(5)).build();
  private final String api;
  private final String key;
  private volatile boolean stopped;

  public Reporter(@Value("${clash.api:http://localhost:4500}") String api,
                  @Value("${clash.internal-key:test-internal-key}") String key) {
    this.api = api;
    this.key = key;
    worker.submit(this::drain);
  }

  public void report(Room.Report match) {
    if (!pending.offer(match)) {
      log.error("report queue full -- match {} not recorded", match.matchId());
    }
  }

  private void drain() {
    while (!stopped) {
      try {
        Room.Report match = pending.take();
        if (!send(match)) log.error("match {} could not be reported", match.matchId());
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      } catch (RuntimeException e) {
        log.error("reporter failed", e);
      }
    }
  }

  boolean send(Room.Report match) {
    for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        HttpRequest request = HttpRequest.newBuilder(URI.create(api + "/internal/matches"))
            .header("content-type", "application/json")
            .header("x-internal-key", key)
            .timeout(Duration.ofSeconds(10))
            .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(match)))
            .build();
        HttpResponse<Void> res = http.send(request, HttpResponse.BodyHandlers.discarding());

        // Reporting is idempotent on matchId, so a retry after a timeout that
        // actually succeeded is harmless -- which is what makes retrying safe
        // rather than a way to double-count a win.
        if (res.statusCode() < 300) return true;

        // Being turned away is not the same as being refused.
        if (res.statusCode() == 401 || res.statusCode() == 403) {
          log.error("match {} rejected as unauthorised -- is clash.internal-key"
              + " the same on both sides?", match.matchId());
          // Falls through to the backoff rather than round the loop: a
          // misconfiguration that retried without waiting would spin.
        } else if (res.statusCode() < 500) {
          // Anything else in the 4xx range is a payload this tier will never
          // accept, and retrying only delays the log line saying so.
          log.error("match {} refused: {}", match.matchId(), res.statusCode());
          return true;
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return false;
      } catch (Exception e) {
        log.debug("reporting {} failed, attempt {}", match.matchId(), attempt + 1, e);
      }
      try {
        Thread.sleep(FIRST_DELAY_MS << attempt);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return false;
      }
    }
    return false;
  }

  /** For the status page, and for a test that wants to see a backlog. */
  public int unreported() {
    return pending.size();
  }

  @Override
  public void close() {
    stopped = true;
    worker.shutdownNow();
  }
}
