package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.play.Mode;
import io.github.excalibase.clashofpokemon.api.play.PlayService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** A match finished somewhere the server could not see it. */
@RestController
class PlayController {

  private final CurrentAccount current;
  private final PlayService plays;

  PlayController(CurrentAccount current, PlayService plays) {
    this.current = current;
    this.plays = plays;
  }

  /**
   * Authenticated, like everything else, and that is what makes it useful: the
   * guest account is created silently on first call, so an offline-only player
   * stops being invisible without ever being asked to sign up. Counting matches
   * without it would say how many were played and never how many people played.
   */
  @PostMapping("/v1/played")
  Map<String, Object> played(HttpServletRequest request, @RequestBody Body body) {
    plays.record(current.require(request), Mode.of(body.mode()));
    return Map.of("ok", true);
  }

  record Body(String mode) {}
}
