package io.github.excalibase.clashofpokemon.api.feedback;

/** Sent too many, too fast. */
public class TooMuchFeedback extends RuntimeException {

  private final int retryAfterSeconds;

  public TooMuchFeedback(int retryAfterSeconds) {
    super("too much feedback");
    this.retryAfterSeconds = retryAfterSeconds;
  }

  public int retryAfterSeconds() {
    return retryAfterSeconds;
  }
}
