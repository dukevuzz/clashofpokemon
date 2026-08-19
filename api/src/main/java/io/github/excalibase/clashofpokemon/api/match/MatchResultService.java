package io.github.excalibase.clashofpokemon.api.match;

import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Recording what happened, exactly once. */
@Service
public class MatchResultService {

  /** A player's history is a page, not an archive. */
  private static final int HISTORY_LIMIT = 50;

  private final MatchRepository matches;

  MatchResultService(MatchRepository matches) {
    this.matches = matches;
  }

  @Transactional
  public void record(FinishedMatch match) {
    Optional<Long> inserted = matches.insertResult(match);

    // Nothing returned means the row already existed: this is a retry, and
    // the records were updated the first time.
    if (inserted.isEmpty()) return;

    for (MatchParticipant player : match.players()) {
      matches.insertPlayer(inserted.get(), player);
      countFor(player, match);
    }
  }

  private void countFor(MatchParticipant player, FinishedMatch match) {
    if (match.drawn()) matches.countDraw(player.accountId());
    else if (match.won(player)) matches.countWin(player.accountId());
    else matches.countLoss(player.accountId());
  }

  public List<PlayedMatch> historyFor(String accountId) {
    return matches.historyFor(accountId, HISTORY_LIMIT);
  }
}
