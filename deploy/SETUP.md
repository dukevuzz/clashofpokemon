# Getting it running on the VPS

Everything below runs on the box. DNS is already correct:
`game` and `api` point at it, `play` is a CNAME at Cloudflare Pages.

## 1. Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # log out and back in for this to take
```

## 2. Ports

Two firewalls, and forgetting the second is the classic way to spend an hour
on this: the cloud panel's rules **and** the machine's own.

```bash
sudo ufw allow 22,80,443/tcp
sudo ufw enable
```

Check Hostinger's panel firewall allows 80 and 443 as well.

## 3. Start it

```bash
git clone https://github.com/excalibase/clashofpokemon.git
cd clashofpokemon/deploy
cp .env.example .env
# fill in DB_PASSWORD and INTERNAL_KEY with long random strings:
#   openssl rand -base64 32

docker compose up -d --build
docker compose logs -f caddy       # watch the certificate arrive
```

Both images build from source in the container, so the box needs no Maven and
no JDK.

## 4. Check it

```bash
curl https://game.clashofpokemon.online/status
curl -o /dev/null -w '%{http_code}\n' https://api.clashofpokemon.online/v1/content
```

The first should report `"ok":true` and a content hash.

## 5. The client

Cloudflare Pages, with the two addresses baked in at build time:

```
VITE_API=https://api.clashofpokemon.online
VITE_GAME_SERVER=https://game.clashofpokemon.online
```

Build command `npm run build`, output `client/dist`, root `client`.

## Deploying again

Tag a release. CI builds both images, pushes them to Docker Hub, and deploys
the client to Cloudflare Pages. Watchtower on this box notices the new image
within two minutes and restarts the service itself -- nothing reaches in.

```bash
git tag v1.2.3 && git push --tags
```

Watchtower only touches containers carrying its label, which is `api` and
`server`. Postgres and Caddy are pinned on purpose and stay where they are.

The restart still drains: `stop_grace_period` is 250s, during which the server
refuses new players and finishes the matches it has. Measured, an idle node
stops in about a second and a busy one takes as long as that match had left.

To deploy by hand instead:

```bash
cd /opt/clashofpokemon/deploy && docker compose pull && docker compose up -d
```

## If something is wrong

| Symptom | Cause |
|---|---|
| Caddy loops, no certificate | DNS not resolving yet, or 80 blocked by either firewall |
| `PLAY ONLINE` never appears | the client cannot reach `/status` — check both names over https |
| Socket connects then closes at once | ticket rejected; check `INTERNAL_KEY` matches on both services |
| Matches play but no records | same key, on the api side — it is one name now, `CLASH_INTERNAL_KEY` |

```bash
docker compose logs -f server
docker compose logs -f api
```
