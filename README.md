# Clash of Pokémon

[play.clashofpokemon.online](https://play.clashofpokemon.online)

A lane battler in the shape of Clash Royale, played with Pokémon. Two players,
three minutes, six cards each, and a board that never pauses.

> [!IMPORTANT]
> **This is a non-commercial fan project.**
>
> Pokémon and all related names, characters and artwork are © Nintendo, Game
> Freak and The Pokémon Company. This project is not affiliated with, endorsed
> by, or in any way associated with them.
>
> Nothing here is sold. There are no advertisements, no purchases, no
> donations, no sponsorship and no revenue of any kind, and there never will
> be. It exists because building it was interesting.
>
> If a rights holder would prefer this did not exist, say so and it will come
> down.

## What it is

- **Server-authoritative.** The client sends intents — "play slot 2 here" —
  and never state. A deploy appears when the server says so.
- **30 Hz simulation, 15 Hz snapshots.** 15 rather than 20 because 20 does not
  divide 30, and the uneven gap shows up as a stutter nobody can find.
- **The match never stops.** Not for a disconnect, not for an open evolution
  choice, not for a tab going to the background. Time passing while you decide
  is the cost of deciding.
- **127 creatures**, each with stats derived from species data rather than
  hand-authored, and evolutions reached by playing a card rather than picked.

## Layout

| | |
|---|---|
| `client/` | Phaser 3, TypeScript. The game, and the rules engine it shares with the server |
| `server/` | Spring Boot. Hosts matches: sockets, matchmaking, the authoritative simulation |
| `api/` | Spring Boot. Accounts, decks, tickets, match history |
| `e2e/` | Drives both services as real processes over HTTP and WebSocket |
| `deploy/` | Compose, Caddy, and what to set |

The rules live in `client/src/core/` and are ported to `server/.../game/rules/`.
The two are held together by a differential test: 26 seeded matches covering
every card in the roster, replayed through both engines and compared. Every
blow struck is identical; health matches exactly.

## Where it runs

| | |
|---|---|
| `play.clashofpokemon.online` | the client — Cloudflare Pages |
| `game.clashofpokemon.online` | matches — the VPS, behind Caddy |
| `api.clashofpokemon.online` | accounts and history — the VPS, behind Caddy |

The two server names are deliberately **not** proxied through Cloudflare:
proxying intercepts port 80, which is how Caddy proves it owns the name, so
certificates would fail — sixty days later, at renewal, rather than now.

## Running it

```bash
# the client, on its own, against a bot
cd client && npm install && npm run dev

# the whole stack, locally: plain ports, no DNS or certificates needed
cd deploy && cp .env.example .env      # then fill it in
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# in production the base file stands alone and Caddy gets real certificates
docker compose up -d
```

Both images build from source, so a clean checkout is all that is needed --
Maven runs inside the build stage and only the jar reaches the final image.

## Tests

```bash
cd client && npx vitest run          # 1,860 — rules, protocol, storage
cd server && ./mvnw test             # 396 — engine, sockets, matchmaking
cd api    && ./mvnw test             # 78 — accounts, tokens, decks (Testcontainers)
cd e2e    && ./mvnw test -DskipTests=false   # both services, real processes
cd client && npx playwright test     # a real browser against a real server
```

The last two need Docker and a built jar in each of `server/target` and
`api/target`.

## Credits

Sprites and species data are drawn from the Pokémon games and from community
resources. Design inspiration from Clash Royale (Supercell) and from
[Pokémon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess),
which showed that a fan project can be built in the open and done well.
