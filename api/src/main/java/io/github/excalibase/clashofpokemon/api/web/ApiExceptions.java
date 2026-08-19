package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.auth.AuthFailed;
import io.github.excalibase.clashofpokemon.api.deck.InvalidDeck;
import io.github.excalibase.clashofpokemon.api.feedback.TooMuchFeedback;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Turning the domain's refusals into answers a client can act on. */
@RestControllerAdvice
class ApiExceptions {

  /** 401 for anything wrong with a credential. */
  @ExceptionHandler(AuthFailed.class)
  ResponseEntity<ApiError> authFailed(AuthFailed e) {
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
        .body(ApiError.of("unauthorized"));
  }

  /** 400 with the reason, so the form can print it under the box. */
  @ExceptionHandler(IllegalArgumentException.class)
  ResponseEntity<ApiError> badRequest(IllegalArgumentException e) {
    return ResponseEntity.badRequest().body(ApiError.of(e.getMessage()));
  }

  /**
   * 429, with Retry-After.
   *
   * The header is there because it is the standard answer and costs nothing;
   * the body carries the same number because the form actually reads that.
   */
  @ExceptionHandler(TooMuchFeedback.class)
  ResponseEntity<Map<String, Object>> tooMuch(TooMuchFeedback e) {
    return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
        .header("Retry-After", String.valueOf(e.retryAfterSeconds()))
        .body(Map.of(
            "error", "you have sent a few already — try again later",
            // Repeated in the body because a header alone is fragile: it needs
            // a CORS exposure to be readable at all, and one misconfigured
            // deployment turns an accurate wait into a wrong one.
            "retryAfterSeconds", e.retryAfterSeconds()));
  }

  /** 422, with every problem named, so the deck screen can point at them. */
  @ExceptionHandler(InvalidDeck.class)
  ResponseEntity<ApiError> invalidDeck(InvalidDeck e) {
    return ResponseEntity.unprocessableEntity().body(new ApiError("invalid deck",
        e.problems().stream()
            .map(p -> new ApiError.Problem(p.field(), p.message()))
            .toList()));
  }
}
