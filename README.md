# Clash of Pokémon

**[www.clashofpokemon.online](https://www.clashofpokemon.online)**

A lane battler played with Pokémon. Two players, three minutes, two bridges.

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

## Playing it

You get six cards and elixir that fills whether you spend it or not. Drop a
creature on your half and it walks. It picks its own fights, crosses at a
bridge, and hits whatever is nearest — you choose what to send and when, never
where it goes after that.

Break a lane tower and that side of the board opens up. Take the king tower,
or be ahead when the clock runs out.

Play the same creature enough and it evolves mid-match. You don't pick the
moment; it arrives because you kept playing the card.

**Nothing pauses.** Not while you decide, not while you read a card, not while
your phone rings. Three minutes means three minutes.

127 creatures. Six-card decks, so a deck is a set of answers rather than a
collection.

## How it's built

The server runs the match and decides everything in it. Your device only tells
it what you tapped, so it can't move a creature or claim a hit that didn't
happen. That's what keeps an online match honest.

The match updates 30 times a second and the server sends you 15 of those; your
device draws the frames in between. 15 divides evenly into 30, so the motion
stays smooth.

Card stats come from the creature data rather than a list someone maintains by
hand, so the numbers can't drift out of step with the roster.

The same rules exist twice — TypeScript for the browser, Java on the server —
and a test replays 26 matches through both to prove they still agree.

## Layout

| | |
|---|---|
| `client/` | Phaser 3, TypeScript. The game, and the rules engine it shares with the server |
| `server/` | Spring Boot. Hosts matches: sockets, matchmaking, the authoritative simulation |
| `api/` | Spring Boot. Accounts, decks, tickets, match history |
| `e2e/` | Drives both services as real processes over HTTP and WebSocket |
| `deploy/` | Compose, Caddy, and what to set |

The rules live in `client/src/core/` and are ported to
`server/.../game/rules/`. The differential test covers every card in the
roster and compares both engines blow by blow.

## Where it runs

| | |
|---|---|
| `www.clashofpokemon.online` | the client — Cloudflare Pages, built from `main` |
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

## Releases

Versions and what changed in each are in [CHANGELOG.md](CHANGELOG.md).
A `v*` tag builds the server images; Cloudflare Pages rebuilds the client
from `main`.

## Credits and licence

The code is MIT. The art is not, and most of it is somebody else's: creature
sprites come from [PMD Sprite Collab](https://sprites.pmdcollab.org/) under
CC BY-NC, and 170 of them are Spike Chunsoft's from the official games.

Everyone who drew something in here is named in [CREDITS.md](CREDITS.md).
Terms are in [LICENSE](LICENSE). Read both before reusing anything under
`client/public/`.
