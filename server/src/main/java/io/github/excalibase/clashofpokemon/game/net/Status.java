package io.github.excalibase.clashofpokemon.game.net;

import java.util.HashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Almost nothing. */
@RestController
public class Status {

  private final Matchmaker matchmaker;
  private final Drain drain;

  public Status(Matchmaker matchmaker, Drain drain) {
    this.matchmaker = matchmaker;
    this.drain = drain;
  }

  /** A match this account is already sitting in, if any. */
  @GetMapping("/me/match")
  public Map<String, Object> myMatch(@RequestParam(name = "account") String account) {
    Map<String, Object> body = new HashMap<>();
    Matchmaker.Seated at = matchmaker.seatOf(account);
    body.put("match", at == null ? null
        : Map.of("left", (int) Math.round(at.room().match.time)));
    return body;
  }

  @GetMapping("/status")
  public Map<String, Object> status() {
    return Map.of(
        "ok", true,
        "queued", matchmaker.queued(),
        // What a deploy script watches: kill this node when it reaches zero.
        "matches", matchmaker.running(),
        "draining", drain.draining(),
        "content", io.github.excalibase.clashofpokemon.game.rules.Cards.version());
  }
}
