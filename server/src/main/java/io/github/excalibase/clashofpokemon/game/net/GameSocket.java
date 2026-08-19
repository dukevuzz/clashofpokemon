package io.github.excalibase.clashofpokemon.game.net;

import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** The socket, and the order things are checked in. */
@Component
public final class GameSocket extends TextWebSocketHandler {

  private static final Logger log = LoggerFactory.getLogger(GameSocket.class);

  private static final ObjectMapper JSON = JsonMapper.builder().build();

  private final Tickets tickets;
  private final Matchmaker matchmaker;
  private final Limits limits;

  /** The one open socket each account is allowed. */
  private final Map<String, WebSocketSession> liveSockets = new ConcurrentHashMap<>();

  private final Map<String, Connection> connections = new ConcurrentHashMap<>();

  private final ScheduledExecutorService deadlines =
      Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "auth-deadline");
        t.setDaemon(true);
        return t;
      });

  private final Drain drain;

  public GameSocket(Tickets tickets, Matchmaker matchmaker, Limits limits, Drain drain) {
    this.tickets = tickets;
    this.matchmaker = matchmaker;
    this.limits = limits;
    this.drain = drain;
  }

  /** Everything this server knows about one socket. */
  private final class Connection implements Seat.Channel {
    private final WebSocketSession session;
    private final Limits.Allowance allowed = limits.allowance();
    private final ScheduledFuture<?> deadline;

    // Volatile, all four, and not as a precaution.
    private volatile Wire.Account account;
    private volatile Room room;
    private volatile Side side;
    private volatile Matchmaker.Waiting waiting;

    Connection(WebSocketSession session) {
      this.session = session;
      // Authenticate promptly or leave.
      this.deadline = deadlines.schedule(() -> {
        if (account == null) {
          send(new Wire.Error("authenticate first"));
          close();
        }
      }, Limits.AUTH_DEADLINE_MS, TimeUnit.MILLISECONDS);
    }

    @Override public void send(Wire.Msg message) {
      if (!session.isOpen()) return;
      try {
        session.sendMessage(new TextMessage(JSON.writeValueAsString(message)));
      } catch (IOException | RuntimeException e) {
        // Already gone. Nothing here can fix that, and a match must not stop
        // because one of its two audiences stopped listening.
        log.debug("send failed on {}", session.getId(), e);
      }
    }

    @Override public void sendBinary(byte[] frame) {
      if (!session.isOpen()) return;
      try {
        session.sendMessage(new BinaryMessage(frame));
      } catch (IOException | RuntimeException e) {
        log.debug("binary send failed on {}", session.getId(), e);
      }
    }

    void close() {
      try {
        session.close();
      } catch (IOException e) {
        log.debug("close failed on {}", session.getId(), e);
      }
    }
  }

  // ------------------------------------------------------------- the socket

  @Override
  public void afterConnectionEstablished(WebSocketSession session) {
    // The only thing checked at the door: whether this node is already holding
    // as many unidentified sockets as it will. Nothing counts addresses --
    // see Limits for why that idea was removed rather than tuned.
    if (!limits.enterLobby()) {
      try {
        session.sendMessage(new TextMessage(JSON.writeValueAsString(
            new Wire.Error("this server is too busy to take new connections"))));
      } catch (IOException | RuntimeException e) {
        log.debug("could not explain refusal to {}", session.getId(), e);
      }
      try {
        session.close(CloseStatus.SERVICE_OVERLOAD);
      } catch (IOException e) {
        log.debug("close failed on {}", session.getId(), e);
      }
      return;
    }
    connections.put(session.getId(), new Connection(session));
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) {
    Connection c = connections.get(session.getId());
    if (c == null) return;

    // Before the parse, not after: a limit that runs afterwards has already
    // paid for the expensive part.
    if (!c.allowed.accept(message.getPayloadLength())) {
      c.send(new Wire.Error(c.allowed.reason()));
      c.close();
      return;
    }

    JsonNode m;
    try {
      m = JSON.readTree(message.getPayload());
    } catch (RuntimeException e) {
      c.send(new Wire.Error("not json"));
      return;
    }

    String type = text(m, "t");
    if ("auth".equals(type)) {
      authenticate(c, m);
      return;
    }
    if (c.account == null) {
      c.send(new Wire.Error("auth first"));
      return;
    }
    if (c.room == null) {
      // Waiting for an opponent. A ping still deserves an answer.
      if ("ping".equals(type)) c.send(new Wire.Pong(number(m, "c"), 0));
      return;
    }
    play(c, type, m);
  }

  private void play(Connection c, String type, JsonNode m) {
    Seat seat = c.room.seat(c.side);
    if (seat == null) return;
    long now = System.currentTimeMillis();

    switch (type == null ? "" : type) {
      case "loaded" -> c.room.loaded(seat, now);
      case "ping" -> c.room.ping(seat, number(m, "c"));
      case "deploy" -> c.room.deploy(seat, number(m, "seq"), (int) number(m, "slot"),
          decimal(m, "x"), decimal(m, "y"), text(m, "form"));
      case "choose" -> c.room.choose(seat, number(m, "seq"),
          text(m, "choiceId"), text(m, "cardId"));
      case "leave" -> c.room.leave(seat, now);
      default -> c.send(new Wire.Error("unknown message"));
    }
  }

  // ---------------------------------------------------------------- the door

  private void authenticate(Connection c, JsonNode m) {
    Tickets.Ticket ticket;
    try {
      ticket = tickets.redeem(text(m, "ticket"));
    } catch (Tickets.BadTicket e) {
      c.send(new Wire.Error(e.getMessage()));
      c.close();
      return;
    }

    // An account here is an id and something to print. Records, decks and
    // credentials live in the meta tier; this process holds no fact about a
    // person that outlives a match.
    Wire.Account account = new Wire.Account(ticket.accountId(), displayName(ticket.accountId()));

    List<String> deck = strings(m.get("deck"));
    String troop = m.has("troop") && !m.get("troop").isNull()
        ? text(m, "troop") : io.github.excalibase.clashofpokemon.game.rules.Rules.troops().getFirst().id();
    String refused = Matchmaker.refuseDeck(deck, troop);
    if (refused != null) {
      c.send(new Wire.Error(refused));
      c.close();
      return;
    }

    // One account, one live connection.
    // Claimed atomically, because two tabs do arrive together.
    if (!claim(account.id(), c.session)) {
      c.send(new Wire.Error("already playing in another tab -- close it, "
          + "or use a private window to play as someone else"));
      c.close();
      return;
    }
    c.account = account;
    c.deadline.cancel(false);

    // Already in a match? Then this is a reconnect, not a new game.
    Matchmaker.Seated existing = matchmaker.seatOf(account.id());
    if (existing != null) {
      c.room = existing.room();
      c.side = existing.side();
      Seat seat = c.room.attach(c.side, c);
      if (seat != null) {
        c.room.rejoin(seat, System.currentTimeMillis());
        // `resync` sends the greeting itself, so a rejoining client walks the
        // same path a joining one does. Two ways to describe a match is two
        // ways for them to describe it differently.
        c.room.resync(seat);
      }
      return;
    }

    // A node that is going away does not take new players.
    if (drain.draining()) {
      c.send(new Wire.Error("this server is winding down -- reconnect to be sent elsewhere"));
      c.close();
      return;
    }

    Matchmaker.Waiting waiting =
        new Matchmaker.Waiting(account, deck, troop, text(m, "branch"), c);
    c.waiting = waiting;

    // Public queue, or a room you chose.
    JsonNode invite = m.get("invite");
    if (invite != null && !invite.isNull()) {
      if (invite.has("create")) {
        c.send(new Wire.Invite(matchmaker.openInvite(waiting)));
        return;
      }
      Room joined = matchmaker.joinInvite(text(invite, "code"), waiting);
      if (joined == null) {
        c.send(new Wire.Error("no room with that code"));
        c.close();
        return;
      }
      remember(joined, account.id());
      return;
    }

    Room made = matchmaker.enqueue(waiting);
    if (made != null) remember(made, account.id());
  }

  /** Take the account's one live socket, or fail because somebody else holds it. */
  private boolean claim(String accountId, WebSocketSession session) {
    while (true) {
      WebSocketSession held = liveSockets.putIfAbsent(accountId, session);
      if (held == null || held == session) return true;
      if (held.isOpen()) return false;
      // Whoever held it has gone. Replace it, and only if it has not changed
      // underneath us in the meantime.
      if (liveSockets.replace(accountId, held, session)) return true;
    }
  }

  /** Point both sockets at the room that just started. */
  private void remember(Room room, String accountId) {
    for (Connection c : connections.values()) {
      if (c.account == null) continue;
      Matchmaker.Seated at = matchmaker.seatOf(c.account.id());
      if (at != null && at.room() == room) {
        c.room = room;
        c.side = at.side();
      }
    }
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    Connection c = connections.remove(session.getId());
    if (c == null) return;
    c.deadline.cancel(false);
    // Left without ever authenticating: give the node-wide slot back.
    if (c.account == null) limits.leaveLobby();

    if (c.waiting != null) {
      matchmaker.leaveQueue(c.waiting);
      // A room whose host left is a code that would seat a stranger.
      matchmaker.cancelInvite(c.waiting);
    }
    // Release the account only if this socket is still the one holding it: a
    // refused second tab must not free the seat its owner is still playing.
    if (c.account != null) liveSockets.remove(c.account.id(), session);
    if (c.room != null && c.side != null) c.room.setLive(c.side, false);
  }

  // -------------------------------------------------------------- plumbing

  /** Something to print, derived rather than stored. */
  static String displayName(String accountId) {
    return accountId.length() > 13 ? accountId.substring(5, 13) : accountId;
  }

  private static String text(JsonNode node, String field) {
    JsonNode v = node == null ? null : node.get(field);
    return v == null || v.isNull() ? null : v.stringValue();
  }

  private static long number(JsonNode node, String field) {
    JsonNode v = node == null ? null : node.get(field);
    return v == null || !v.isNumber() ? 0 : v.longValue();
  }

  private static double decimal(JsonNode node, String field) {
    JsonNode v = node == null ? null : node.get(field);
    return v == null || !v.isNumber() ? Double.NaN : v.doubleValue();
  }

  private static List<String> strings(JsonNode array) {
    if (array == null || !array.isArray()) return List.of();
    List<String> out = new java.util.ArrayList<>(array.size());
    for (JsonNode n : array) if (n.isString()) out.add(n.stringValue());
    return out;
  }
}
