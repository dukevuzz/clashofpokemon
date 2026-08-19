package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.feedback.FeedbackService;
import io.github.excalibase.clashofpokemon.api.feedback.Kind;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Where a player says what is wrong, or what would be better. */
@RestController
class FeedbackController {

  private final CurrentAccount current;
  private final FeedbackService feedback;

  FeedbackController(CurrentAccount current, FeedbackService feedback) {
    this.current = current;
    this.feedback = feedback;
  }

  /**
   * Authenticated, because everybody playing already has an account and it is
   * what the rate limit hangs off. It is not a barrier: a first-time visitor
   * becomes a guest the moment they open the form.
   */
  @PostMapping("/v1/feedback")
  Map<String, Object> submit(HttpServletRequest request, @RequestBody Body body) {
    long id = feedback.submit(
        current.require(request), body.kindOrBug(), body.message(), body.context());
    return Map.of("id", id);
  }

  record Body(String kind, String message, Map<String, Object> context) {
    /** An unspecified report is a bug report; that is what people send. */
    Kind kindOrBug() {
      return kind == null || kind.isBlank() ? Kind.BUG : Kind.of(kind);
    }
  }
}
