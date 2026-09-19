# Plans

Written down so they survive a context compaction or a reboot. If you are picking
this project back up, read this file first.

## Open work

| | What | Size | State |
|---|---|---|---|
| 1 | [Weather and terrain](weather-and-terrain.md) | weekend (visual) | **ACTIVE** — visual pass, deck-derived, no engine change |
| 2 | [Arena identity](map-scenery.md) | few days | PARKED — [preview rendered](https://claude.ai/code/artifact/e03a2b5d-2fa2-4d9a-9995-1292f5199faa), method solved; needs the board-size call |
| 3 | Collection on the server | few days | **API deployed and unused** — client still on localStorage |
| 4 | Emotes in match | weekend | not started; best value on the gap board |
| 5 | [Replays / shareable matches](replays.md) | **days, not a fortnight** | not started — determinism already proven, 28/28 matches reproduce, 549 bytes each |
| 6 | [Raid mode](raids.md) | large | design sketch — the mode that removes the need for two people online at once |

The ranked feature board (drag-to-reorder, tickable) lives at
https://claude.ai/code/artifact/4b6a860f-5ae0-41b9-9533-bbebdc1f21ec
and the reasoning behind its order is in memory as `clash-royale-gap-board`.

## One decision waiting on Duc

- **Do chests require a connection?** Blocks #3. Server-authoritative means no
  merge logic ever but no offline packs; offline-tolerant means a reconciliation
  rule that is a permanent bug source.

*(The tileset licence question is closed — PAC's tilesets and DTEF are the same
corpus in the same format, and four of them already ship here, credited. See
[map-scenery.md](map-scenery.md).)*

## Hygiene, not priorities

Fold these into whatever is being touched anyway; they should not take a slot.

- 26 deck e2e tests skipped (`client/tests/e2e/deck.spec.ts`, `deck.mega.spec.ts`)
  — written against the Phaser canvas, but Deck is React now.
- `PlayThroughTest.abranchIsAnsweredOnceAndCannotBeSwitched` is flaky — a
  websocket race. Passes 5/5 locally, fell over in CI.
- Rotate VPS root password, Docker Hub password, Gemini API key.

## Standing rules

- **Nothing enters the repo unless its licence is a named public licence with a
  version number.** The exceptions already made are recorded in `CREDITS.md`.
- Never SSH into the production VPS to restart things on a guess.
- Pushing `main` **deploys the client** — Cloudflare Pages auto-builds. `deploy.yml`
  only builds Docker images on a `v*` tag, and containers need a manual VPS pull.
  Three triggers, not one.
