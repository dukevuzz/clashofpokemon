package io.github.excalibase.clashofpokemon.api.feedback;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Taking a report, and deciding whether to.
 *
 * The rules are deliberately gentle. This is a box a frustrated player types
 * into, and a service that argues with them about formatting is a service that
 * gets nothing reported. So: a length floor low enough for "towers dont shoot"
 * and a ceiling high enough for a genuine essay, and no required fields beyond
 * the message itself.
 *
 * The rate limit is the one hard rule, and it is per account rather than per
 * IP -- an account is what we have, IP limiting was removed from this codebase
 * on purpose, and anybody willing to mint guests to get past this could get
 * past an IP limit with the same effort.
 */
@Service
public class FeedbackService {

  /** Enough to say something; short enough that "it broke" gets through. */
  static final int MIN_LENGTH = 4;

  /**
   * The database enforces this too. Long enough for a real bug report with
   * steps, short enough that nobody pastes a log file into it.
   */
  static final int MAX_LENGTH = 2000;

  /** Per account, per window. Room to send a few in one sitting, not a flood. */
  static final int MAX_PER_WINDOW = 5;
  static final Duration WINDOW = Duration.ofHours(1);

  /** Context keys we keep. Anything else the client sends is dropped. */
  private static final int MAX_CONTEXT_VALUE = 400;

  private final FeedbackRepository reports;

  FeedbackService(FeedbackRepository reports) {
    this.reports = reports;
  }

  public long submit(String accountId, Kind kind, String rawMessage, Map<String, Object> context) {
    String message = rawMessage == null ? "" : rawMessage.strip();
    if (message.length() < MIN_LENGTH) {
      throw new IllegalArgumentException("say a little more than that");
    }
    if (message.length() > MAX_LENGTH) {
      throw new IllegalArgumentException("that is longer than " + MAX_LENGTH + " characters");
    }

    if (reports.countSince(accountId, WINDOW) >= MAX_PER_WINDOW) {
      throw new TooMuchFeedback(retryAfter(accountId));
    }

    return reports.save(accountId, kind, message, clean(context));
  }

  /**
   * How long until the oldest report in the window ages out.
   *
   * Approximated from the most recent one rather than queried exactly: the
   * client only needs a number to put in a sentence, and being a few minutes
   * pessimistic is kinder than being optimistic and refusing them twice.
   */
  private int retryAfter(String accountId) {
    Instant last = reports.lastSentAt(accountId);
    if (last == null) return (int) WINDOW.toSeconds();
    long elapsed = Duration.between(last, Instant.now()).toSeconds();
    return (int) Math.max(60, WINDOW.toSeconds() - elapsed);
  }

  /**
   * Context is free-form, so it is bounded rather than validated.
   *
   * A client that sends a hundred keys, or one key holding a stack trace, is
   * far more likely to be a bug in the client than an attack -- but either way
   * the row should stay a reasonable size, and truncating is better than
   * refusing a report because its metadata was untidy.
   */
  private Map<String, Object> clean(Map<String, Object> context) {
    if (context == null || context.isEmpty()) return Map.of();
    var out = new LinkedHashMap<String, Object>();
    for (var entry : context.entrySet()) {
      if (out.size() >= 20) break;
      Object value = entry.getValue();
      if (value == null) continue;
      String text = String.valueOf(value);
      out.put(entry.getKey(),
          text.length() > MAX_CONTEXT_VALUE ? text.substring(0, MAX_CONTEXT_VALUE) : text);
    }
    return out;
  }
}
