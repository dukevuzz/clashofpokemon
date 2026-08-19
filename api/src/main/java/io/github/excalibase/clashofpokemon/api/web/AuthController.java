package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.auth.GuestService;
import io.github.excalibase.clashofpokemon.api.auth.TokenService;
import io.github.excalibase.clashofpokemon.api.ticket.TicketService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Becoming somebody, staying somebody, and getting into a match. */
@RestController
@RequestMapping("/v1/auth")
class AuthController {

  private final GuestService guests;
  private final TokenService tokens;
  private final TicketService tickets;
  private final CurrentAccount current;

  AuthController(GuestService guests, TokenService tokens,
      TicketService tickets, CurrentAccount current) {
    this.guests = guests;
    this.tokens = tokens;
    this.tickets = tickets;
    this.current = current;
  }

  /** Play first, register later. No screen, no password, no email. */
  @PostMapping("/guest")
  Map<String, Object> guest() {
    var created = guests.create();
    return Map.of("account", created.account(), "refresh", created.refresh());
  }

  /** Spend a refresh token for a session. The old one dies here. */
  @PostMapping("/refresh")
  Map<String, Object> refresh(@RequestBody Map<String, String> body) {
    var session = tokens.refresh(body.get("refresh"));
    return Map.of(
        "accountId", session.accountId(),
        "access", session.access(),
        "refresh", session.refresh());
  }

  @PostMapping("/logout")
  void logout(@RequestBody Map<String, String> body) {
    tokens.logout(body.get("refresh"));
  }

  /** Permission to open a game socket. */
  @PostMapping("/ticket")
  Map<String, Object> ticket(HttpServletRequest request) {
    var issued = tickets.issue(current.require(request));
    return Map.of("ticket", issued.token(), "expiresIn", issued.expiresIn());
  }
}
