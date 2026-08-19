#!/usr/bin/env bash
#
# Both Java services and a Postgres, for driving a real browser at them.
#
# The browser suite in phaser/tests/e2e is the only thing that exercises the
# client and the server together, and it needs three processes the unit tests
# never start. Without this script that setup lives in somebody's shell
# history, which is where the Java port went unverified against the real
# client for a week -- two events had the wrong field names, the server was
# self-consistent, and every Java test passed.
#
#   ./run-stack.sh              start everything
#   ./run-stack.sh stop         stop everything
#
# Then:  cd client && npx playwright test tests/e2e/online.spec.ts
set -euo pipefail
cd "$(dirname "$0")"

KEY=browser-run
PG_PORT=55432

stop() {
  pkill -f 'gameserver-.*\.jar' 2>/dev/null || true
  pkill -f 'api-.*\.jar' 2>/dev/null || true
  docker rm -f lr-pg >/dev/null 2>&1 || true
  echo "stopped"
}

# Refuse to start on a port somebody else holds.
#
# This is not tidiness. The first version simply waited for /status to answer,
# and the old Node server -- still running from months earlier, and answering
# /status perfectly well -- was what answered. The Java jar had already exited
# with "port in use", the script reported success, and the browser suite then
# passed twice against the server we were replacing. A health check that
# cannot tell our service from somebody else's is worse than none, because it
# produces confident evidence for the wrong thing.
free() {
  if ss -ltn "sport = :$1" 2>/dev/null | tail -n +2 | grep -q .; then
    echo "port $1 is already in use -- stop whatever holds it first:" >&2
    ss -ltnp "sport = :$1" 2>/dev/null | tail -n +2 >&2
    exit 1
  fi
}

if [ "${1:-start}" = stop ]; then stop; exit 0; fi

for module in api server; do
  if ! ls "$module"/target/*.jar >/dev/null 2>&1; then
    echo "no jar in $module/target -- run: (cd $module && ./mvnw package -DskipTests)" >&2
    exit 1
  fi
done

stop
free 4500
free 4400
free "$PG_PORT"
docker run -d --name lr-pg -e POSTGRES_PASSWORD=lane -e POSTGRES_USER=lane \
  -e POSTGRES_DB=lane -p "$PG_PORT":5432 postgres:16-alpine >/dev/null
until docker exec lr-pg pg_isready -U lane >/dev/null 2>&1; do sleep 1; done

# The meta tier first: the game server fetches its public key at startup.
nohup java -jar api/target/clashofpokemon-api-*.jar --server.port=4500 \
  --spring.datasource.url="jdbc:postgresql://localhost:$PG_PORT/lane" \
  --spring.datasource.username=lane --spring.datasource.password=lane \
  --clash.internal-key="$KEY" >/tmp/clash-api.log 2>&1 &
until curl -sf http://localhost:4500/v1/content >/dev/null; do sleep 1; done

# The same key on both sides, spelled the same way. They were once
# `lane.internal.key` here and `clash.internal-key` there, both with
# defaults, so nothing failed to start and every match result was discarded.
nohup java -jar server/target/clashofpokemon-server-*.jar --server.port=4400 \
  --clash.api=http://localhost:4500 --clash.internal-key="$KEY" \
  >/tmp/clash-game.log 2>&1 &
until curl -sf http://localhost:4400/status >/dev/null; do sleep 1; done

# And prove it is ours. `content` is the roster version, which only the Java
# server reports -- the Node one answered /status without it.
if ! curl -s http://localhost:4400/status | grep -q '"content"'; then
  echo "something is answering :4400 but it is not this game server" >&2
  exit 1
fi

echo "api      :4500   (log /tmp/clash-api.log)"
echo "game     :4400   (log /tmp/clash-game.log)"
echo "postgres :$PG_PORT"
echo
echo "now:  cd client && npx playwright test tests/e2e/online.spec.ts"
