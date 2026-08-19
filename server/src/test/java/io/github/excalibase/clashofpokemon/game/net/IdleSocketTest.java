package io.github.excalibase.clashofpokemon.game.net;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

/** What the container does to a socket that says nothing. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "clash.socket-idle-ms=2000")
class IdleSocketTest {

  @org.springframework.beans.factory.annotation.Value("${local.server.port}")
  private int port;

  @Test
  void aSilentSocketIsClosedByTheContainer() throws Exception {
    CountDownLatch closed = new CountDownLatch(1);
    WebSocketSession session = new StandardWebSocketClient().execute(
        new AbstractWebSocketHandler() {
          @Override public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
            closed.countDown();
          }
        }, "ws://localhost:" + port + "/play").get(5, TimeUnit.SECONDS);

    assertThat(session.isOpen()).isTrue();
    assertThat(closed.await(10, TimeUnit.SECONDS))
        .as("a socket that says nothing is hung up on")
        .isTrue();
  }
}
