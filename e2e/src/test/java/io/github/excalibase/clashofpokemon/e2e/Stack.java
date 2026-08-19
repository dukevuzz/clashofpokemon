package io.github.excalibase.clashofpokemon.e2e;

import java.io.File;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.testcontainers.containers.PostgreSQLContainer;

/** Both services, running for real. */
final class Stack implements AutoCloseable {

  private static final HttpClient HTTP = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(5)).build();

  private final PostgreSQLContainer<?> postgres;
  private final Process api;
  private final Process game;
  private final List<Path> logs = new ArrayList<>();

  final int apiPort;
  final int gamePort;
  final String internalKey = "e2e-internal-key";

  Stack() throws Exception {
    apiPort = freePort();
    gamePort = freePort();

    postgres = new PostgreSQLContainer<>("postgres:16-alpine");
    postgres.start();

    // The meta tier first: the game server fetches its public key at startup.
    api = start("api", jar("api"), List.of(
        "--server.port=" + apiPort,
        "--spring.datasource.url=" + postgres.getJdbcUrl(),
        "--spring.datasource.username=" + postgres.getUsername(),
        "--spring.datasource.password=" + postgres.getPassword(),
        "--clash.internal-key=" + internalKey));
    waitFor("http://localhost:" + apiPort + "/v1/content", "the meta tier");

    game = start("game", jar("server"), List.of(
        "--server.port=" + gamePort,
        "--clash.api=http://localhost:" + apiPort,
        "--clash.internal-key=" + internalKey));
    waitFor("http://localhost:" + gamePort + "/status", "the game server");
  }

  /** The jar as it ships. */
  private static Path jar(String module) throws IOException {
    Path target = Path.of("..", module, "target");
    try (var files = Files.list(target)) {
      return files
          .filter(p -> p.getFileName().toString().endsWith(".jar"))
          .filter(p -> !p.getFileName().toString().contains("sources"))
          .findFirst()
          .orElseThrow(() -> new IllegalStateException(missing(module)));
    } catch (IOException e) {
      throw new IllegalStateException(missing(module), e);
    }
  }

  private static String missing(String module) {
    return "no jar in " + module + "/target -- run:  (cd " + module + " && ./mvnw package -DskipTests)";
  }

  private Process start(String name, Path jar, List<String> args) throws IOException {
    List<String> command = new ArrayList<>(List.of(
        Path.of(System.getProperty("java.home"), "bin", "java").toString(),
        "-jar", jar.toAbsolutePath().toString()));
    command.addAll(args);

    // Output to a file rather than inherited, so a failure has something to
    // read afterwards instead of two interleaved logs on one console.
    Path log = Files.createTempFile("clash-" + name + "-", ".log");
    logs.add(log);
    return new ProcessBuilder(command)
        .redirectErrorStream(true)
        .redirectOutput(log.toFile())
        .start();
  }

  private void waitFor(String url, String what) throws Exception {
    long deadline = System.currentTimeMillis() + 90_000;
    Exception last = null;
    while (System.currentTimeMillis() < deadline) {
      try {
        HttpResponse<Void> res = HTTP.send(
            HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(2)).build(),
            HttpResponse.BodyHandlers.discarding());
        if (res.statusCode() < 500) return;
      } catch (Exception e) {
        last = e;
      }
      Thread.sleep(250);
    }
    throw new IllegalStateException(what + " never came up.\n" + tail(), last);
  }

  /** Whatever the two services said, for a failure that would otherwise be blank. */
  String tail() {
    StringBuilder out = new StringBuilder();
    for (Path log : logs) {
      out.append("\n--- ").append(log.getFileName()).append(" ---\n");
      try {
        List<String> lines = Files.readAllLines(log);
        lines.subList(Math.max(0, lines.size() - 40), lines.size())
            .forEach(l -> out.append(l).append('\n'));
      } catch (IOException e) {
        out.append("(unreadable: ").append(e.getMessage()).append(")\n");
      }
    }
    return out.toString();
  }

  private static int freePort() throws IOException {
    try (ServerSocket socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    }
  }

  @Override
  public void close() {
    if (game != null) game.destroy();
    if (api != null) api.destroy();
    if (postgres != null) postgres.stop();
    for (Path log : logs) new File(log.toString()).delete();
  }
}
