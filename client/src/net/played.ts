/**
 * Telling the server a match happened that it could not see.
 *
 * Offline and tutorial matches are simulated here and stored here, so the only
 * players the server could count were the ones who pressed PLAY ONLINE. That
 * made the retention numbers unreadable: somebody who plays five bot matches
 * and never goes online was indistinguishable from somebody who left. Reported
 * from the other direction too -- people are playing offline, and none of it
 * showed up anywhere.
 *
 * What goes over the wire is the mode and nothing else. Not the deck, not the
 * result, not how long it lasted. The question is "is anyone playing this",
 * and that is all this can answer.
 *
 * Failure is silence on purpose. A count that could interrupt a game, delay
 * the result screen, or raise an error a player has to dismiss would be worth
 * less than the count is worth -- so every path here ends in a shrug.
 */

import { apiBase, authorized, signIn } from "./identity";

export type Mode = "offline" | "tutorial";

/** How it ended, from this player's side. Absent for the tutorial. */
export type Result = "win" | "loss" | "draw";

/**
 * Report a finished match, and never make it the player's problem.
 *
 * Not awaited by callers: this is fired at the moment a result screen goes up,
 * and the result screen must not wait for a network round trip to appear.
 */
export function record(mode: Mode, result?: Result): void {
  void (async () => {
    try {
      await signIn();
      await authorized(`${apiBase()}/v1/played`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The result travels with it so the account's record counts every
        // match, not only the online ones. Without that a player's record
        // lived in one browser and vanished on the next device.
        body: JSON.stringify({ mode, result }),
      });
    } catch {
      // Offline in the literal sense, an old build, a server being restarted.
      // The player is mid-way through being told whether they won; none of
      // that is worth a word to them.
    }
  })();
}
