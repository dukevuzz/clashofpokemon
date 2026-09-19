# Replays and shareable matches

Status: **not built — but far cheaper than the board estimated.** Measured 2026-09-06.

## The finding

The board called this "a fortnight, the strategic bet". **The hard half is already
built and proven.** A match is fully reproducible from a seed and a list of plays,
and there is a recorded fixture format that already does exactly this.

Proven, not assumed: all **28 recorded matches in `differential.json` reproduce
exactly** — identical final tower HP and identical winner — when re-run from
`seed + decks + allowed plays` alone.

```
reproduced exactly: 28/28
```

The engine takes `rng` as a constructor option (`Match({ rng })`), and the
differential test already replays these 28 matches through *two* independent
engines in *two languages* and demands they agree blow for blow. That test is a
determinism proof that happens to have been written for another purpose.

## What a replay actually costs

Everything needed to reconstruct a match:

```json
{"seed":1000,
 "deckOne":["charmander","squirtle","aron","spearow","pidgey","fennekin"],
 "deckTwo":["litwick","bulbasaur","machop","zubat","geodude","caterpie"],
 "plays":[{"step":216,"side":2,"slot":0,"x":140.23,"y":282.54}, ...]}
```

| | |
|---|---|
| Plays in a real match | ~26 (the other 29 attempts were refused and are not needed) |
| Raw JSON | **1,551 bytes** |
| Gzipped | **549 bytes** |

Half a kilobyte for a complete three-minute match. That fits in a URL fragment,
a database column, a QR code, a chat message.

**Rejected plays must be dropped.** The recording keeps `allowed: false` rows for
the differential test's benefit; replaying them would double-spend elixir. Only
plays that actually landed go in.

## What is missing

The recording format and the determinism are done. What is not:

1. **Record a live match into this format.** The server already receives every
   `{t:"deploy", seq, slot, x, y}` and already owns the match seed. This is
   capturing what it already has, not deriving anything new.
2. **Store it.** One table: id, both accounts, the blob, when. A column, given
   the size above.
3. **Serve it.** `GET /replay/{id}` and a page that runs `BattleScene` against a
   scripted input source rather than a socket.
4. **Playback controls.** Pause, scrub, speed. Scrubbing backwards means
   re-running from step 0 to the target step — at 549 bytes and 5,460 steps that
   is microseconds, so no snapshot machinery is needed.

Nothing on that list requires touching the rules engine, which is what made the
original estimate large.

## Why it is still ranked first

**A shareable match is the only feature that works as well at three players as
at three thousand.** Everything else on the board makes an existing match better
for people already playing. This one lets a match reach somebody who is not.

Spectating falls out of the same work: a live spectator is a replay whose plays
are still arriving.

And it compounds with the raid mode — see `raids.md`. An async raid **is** a
replay. Build this and the defender's "someone attacked your base" view is
already done.

## Order to build

1. Server records finished matches into the lean format. Verifiable immediately:
   re-run each recorded match and assert the final tower HP matches what actually
   happened, which is the same check that proved this works.
2. Store and serve by id.
3. The playback page.
4. Sharing UI.

Step 1 alone is worth shipping — a recorded match that nothing can play back yet
is still evidence the format survives contact with real play.
