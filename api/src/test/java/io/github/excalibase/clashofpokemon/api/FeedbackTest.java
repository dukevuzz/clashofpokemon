package io.github.excalibase.clashofpokemon.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.auth.GuestService;
import io.github.excalibase.clashofpokemon.api.feedback.FeedbackRepository;
import io.github.excalibase.clashofpokemon.api.feedback.FeedbackService;
import io.github.excalibase.clashofpokemon.api.feedback.Kind;
import io.github.excalibase.clashofpokemon.api.feedback.TooMuchFeedback;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * Reporting a bug.
 *
 * The interesting cases are all refusals: what a report has to clear to be
 * stored, and what stops one player filling the table. The happy path is an
 * insert and barely worth a test on its own -- it is here because the rate
 * limit tests need to know it worked.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class FeedbackTest {

  @Autowired FeedbackService feedback;
  @Autowired FeedbackRepository reports;
  @Autowired GuestService guests;

  private String someone() {
    return guests.create().account().id();
  }

  @Test
  void storesAReportAndGivesItBack() {
    String me = someone();
    long id = feedback.submit(me, Kind.BUG, "  towers do not shoot fliers  ",
        Map.of("screen", "battle", "build", "abc123"));

    assertThat(id).isPositive();
    var stored = reports.recent(50).stream().filter(r -> r.id() == id).findFirst().orElseThrow();
    // Stripped, because a message that begins with the player's stray spaces
    // is a message that fails a length check for no reason.
    assertThat(stored.message()).isEqualTo("towers do not shoot fliers");
    assertThat(stored.kind()).isEqualTo(Kind.BUG);
    assertThat(stored.context()).containsEntry("screen", "battle");
    assertThat(stored.handledAt()).isNull();
  }

  @Test
  void refusesSomethingTooShortToActOn() {
    assertThatThrownBy(() -> feedback.submit(someone(), Kind.BUG, "no", Map.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("say a little more");
  }

  @Test
  void refusesAPastedLogFile() {
    assertThatThrownBy(() ->
        feedback.submit(someone(), Kind.BUG, "x".repeat(2001), Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void stopsOneAccountFillingTheTable() {
    String me = someone();
    for (int i = 0; i < 5; i++) {
      feedback.submit(me, Kind.SUGGESTION, "idea number " + i, Map.of());
    }

    assertThatThrownBy(() -> feedback.submit(me, Kind.BUG, "one too many", Map.of()))
        .isInstanceOf(TooMuchFeedback.class)
        .satisfies(e -> assertThat(((TooMuchFeedback) e).retryAfterSeconds()).isPositive());
  }

  @Test
  void oneAccountsLimitIsNotEverybodysLimit() {
    String noisy = someone();
    for (int i = 0; i < 5; i++) {
      feedback.submit(noisy, Kind.BUG, "report " + i, Map.of());
    }
    // The limit is per account. A shared limit would let one player silence
    // everybody else, which is a worse failure than the one it prevents.
    assertThat(feedback.submit(someone(), Kind.BUG, "my own report", Map.of())).isPositive();
  }

  @Test
  void keepsContextBoundedRatherThanRefusingIt() {
    String me = someone();
    var huge = new HashMap<String, Object>();
    for (int i = 0; i < 40; i++) huge.put("key" + i, "v".repeat(1000));

    long id = feedback.submit(me, Kind.BUG, "something odd happened", huge);
    var stored = reports.recent(50).stream().filter(r -> r.id() == id).findFirst().orElseThrow();

    // Truncated, not rejected: untidy metadata must never cost us the report.
    assertThat(stored.context()).hasSizeLessThanOrEqualTo(20);
    assertThat(stored.context().values())
        .allSatisfy(v -> assertThat(String.valueOf(v).length()).isLessThanOrEqualTo(400));
  }

  @Test
  void countsOnlyThisAccountsRecentReports() {
    String me = someone();
    assertThat(reports.countSince(me, java.time.Duration.ofHours(1))).isZero();
    feedback.submit(me, Kind.BUG, "the first one", Map.of());
    assertThat(reports.countSince(me, java.time.Duration.ofHours(1))).isEqualTo(1);
  }

  @Test
  void aReportWithNoContextIsStillAReport() {
    long id = feedback.submit(someone(), Kind.SUGGESTION, "let us rename our deck", null);
    var stored = reports.recent(50).stream().filter(r -> r.id() == id).findFirst().orElseThrow();
    assertThat(stored.context()).isEmpty();
  }
}
