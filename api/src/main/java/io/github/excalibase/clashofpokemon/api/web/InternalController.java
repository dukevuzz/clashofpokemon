package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.feedback.FeedbackRepository;
import io.github.excalibase.clashofpokemon.api.feedback.Report;
import io.github.excalibase.clashofpokemon.api.match.FinishedMatch;
import io.github.excalibase.clashofpokemon.api.match.MatchResultService;
import io.github.excalibase.clashofpokemon.api.ticket.TicketKeys;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import java.util.List;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.HttpStatus;

/** What the game server calls, and nobody else. */
@RestController
@RequestMapping("/internal")
class InternalController {

  private final MatchResultService matches;
  private final TicketKeys keys;
  private final FeedbackRepository feedback;

  InternalController(MatchResultService matches, TicketKeys keys,
      FeedbackRepository feedback) {
    this.matches = matches;
    this.keys = keys;
    this.feedback = feedback;
  }

  /** Public key material, deliberately unauthenticated. */
  @GetMapping(value = "/jwks", produces = MediaType.APPLICATION_JSON_VALUE)
  String jwks() {
    return keys.publicJwks();
  }

  /**
   * What players have reported. Behind the internal guard, because it is other
   * people's words about their own accounts and no player has any business
   * reading another's.
   */
  @GetMapping("/feedback")
  List<Report> feedback(@RequestParam(defaultValue = "50") int limit) {
    return feedback.recent(Math.clamp(limit, 1, 500));
  }

  /** Idempotent on matchId: a retry after a timeout is normal traffic. */
  @PostMapping("/matches")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void report(@RequestBody FinishedMatch match) {
    matches.record(match);
  }
}
