package io.github.excalibase.clashofpokemon.game.net;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/** One socket, at one path. */
@Configuration
@EnableWebSocket
public class SocketConfig implements WebSocketConfigurer {

  private final GameSocket socket;
  private final long idleTimeoutMs;

  public SocketConfig(GameSocket socket,
      @org.springframework.beans.factory.annotation.Value(
          "${clash.socket-idle-ms:120000}") long idleTimeoutMs) {
    this.socket = socket;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    // Both paths, and not by accident. The client that already exists opens
    // `ws://host:4400` with no path at all, so the root has to work or nothing
    // connects; `/play` is the name to move to, and is what the tests use.
    registry.addHandler(socket, "/", "/play").setAllowedOriginPatterns("*");
  }

  /** Frames larger than a message can honestly be are refused by the container. */
  @org.springframework.context.annotation.Bean
  public ServletServerContainerFactoryBean webSocketContainer() {
    var container = new ServletServerContainerFactoryBean();
    container.setMaxTextMessageBufferSize(Limits.MAX_FRAME_BYTES * 2);
    container.setMaxBinaryMessageBufferSize(Limits.MAX_FRAME_BYTES * 2);
    // A socket with nothing to say is a socket that has gone away without
    // telling us. The client pings; this is the backstop.
    container.setMaxSessionIdleTimeout(idleTimeoutMs);
    return container;
  }
}
