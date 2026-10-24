#!/usr/bin/env bash
# The image smoke test (plan 3, Task 5): build the image, run it against a throwaway Postgres, and check that it
# serves, stops cleanly on SIGTERM (exit 0, CLIs told 1012 "server restarting") and starts again on a database whose
# migrations already ran. Everything it makes is removed at the end, pass or fail. See docs/why/docker-images.md.
#
#   npm run image:smoke                              build, then test
#   NITPILOT_SMOKE_SKIP_BUILD=1 npm run image:smoke  test an image already tagged nitpilot:smoke (CI builds it first)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=nitpilot:smoke
RUN="nitpilot-smoke-$$"
NET="$RUN-net"
DB="$RUN-db"
APP="$RUN-app"
WS="$RUN-ws"
MEMORY_LIMIT_MIB=384

# Test-only values for a database that lives for a minute. None of them is a secret.
DB_URL="postgresql://nitpilot:smoke@$DB:5432/nitpilot"
SMOKE_TOKEN='nit_image-smoke-only-not-a-real-token'
SMOKE_TOKEN_HASH='74bf1f0eb2c7a3bd187e3c4af546ecf3b98d077eb1c3691865651b8c3276f7eb' # sha256 of SMOKE_TOKEN

cleanup() {
  docker rm -f "$WS" "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "image-smoke: FAIL: $*" >&2
  if docker inspect "$APP" >/dev/null 2>&1; then
    echo "--- server log (last 40 lines) ---" >&2
    docker logs "$APP" 2>&1 | tail -40 >&2 || true
  fi
  exit 1
}

step() { echo "image-smoke: $*"; }

# Does this text contain the pattern? (Not `cmd | grep -q`: grep stops reading early, and under pipefail the command
# it cut off counts as failed.)
contains() { grep -q -- "$2" <<<"$1"; }

if [ "${NITPILOT_SMOKE_SKIP_BUILD:-}" != "1" ]; then
  step "building $IMAGE"
  docker build -t "$IMAGE" . || fail "docker build failed"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "no image $IMAGE (is there a Dockerfile?)"

step "starting a throwaway Postgres"
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
  -e POSTGRES_USER=nitpilot -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=nitpilot \
  postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -U nitpilot -d nitpilot >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB" pg_isready -U nitpilot -d nitpilot >/dev/null 2>&1 || fail "Postgres never became ready"

step "starting the server"
# Placeholder GitHub App values: the server starts with them, and its one GitHub call at boot (asking for failed
# deliveries) fails to sign and is logged and skipped, so the test never talks to GitHub.
# --init puts a tiny init process (tini) in front, as compose's `init: true` does, so `docker stop` reaches node.
docker run -d --init --name "$APP" --network "$NET" -p 127.0.0.1::8787 \
  -e DATABASE_URL="$DB_URL" \
  -e PUBLIC_URL=http://localhost:8787 \
  -e ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  -e GITHUB_APP_ID=1 \
  -e GITHUB_APP_SLUG=nitpilot-smoke \
  -e GITHUB_APP_PRIVATE_KEY=not-a-real-key \
  -e GITHUB_CLIENT_ID=smoke-client-id \
  -e GITHUB_CLIENT_SECRET=smoke-client-secret \
  -e GITHUB_WEBHOOK_SECRET=smoke-webhook-secret \
  "$IMAGE" >/dev/null
# The host port is picked by Docker, and picked again on every start.
base_url() { echo "http://127.0.0.1:$(docker port "$APP" 8787/tcp | head -1 | sed 's/.*://')"; }

wait_healthy() {
  BASE=$(base_url)
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = "true" ] || fail "the server exited while starting"
    contains "$(curl -fsS "$BASE/healthz" 2>/dev/null || true)" '"ok":true' && return 0
    sleep 1
  done
  fail "/healthz never answered 200"
}

wait_healthy
step "/healthz answers"

# Docker's own HEALTHCHECK (the one compose and `docker ps` show) runs inside the container: wait for it too.
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = "healthy" ] || fail "Docker's HEALTHCHECK never reported healthy"
step "Docker reports the container healthy"

contains "$(curl -fsS "$BASE/" || true)" '<title>Nitpilot</title>' || fail "GET / is not the web app's index.html"
step "GET / is the web app"

# A connected CLI, to see the 1012 it gets on shutdown: a user and a CLI token straight into the throwaway database,
# then a WebSocket client run from the same image (it has the ws package) on the same network. It never says hello,
# and the hub closes such a socket after 10 s (ws/cli-hub.ts), so the stop below comes right after it opens.
docker exec "$DB" psql -q -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot -c "
  INSERT INTO \"User\" (id, \"githubId\", login, \"updatedAt\") VALUES ('smoke-user', '1', 'smoke', now());
  INSERT INTO \"CliToken\" (id, \"userId\", name, \"tokenHash\", prefix, \"updatedAt\")
    VALUES ('smoke-token', 'smoke-user', 'smoke', '$SMOKE_TOKEN_HASH', 'nit_imag', now());" >/dev/null \
  || fail "could not add the smoke CLI token"
docker run -d --name "$WS" --network "$NET" -e SMOKE_TOKEN="$SMOKE_TOKEN" "$IMAGE" node -e "
  const WebSocket = require('ws');
  const ws = new WebSocket('ws://$APP:8787/ws/cli', { headers: { authorization: 'Bearer ' + process.env.SMOKE_TOKEN } });
  ws.on('open', () => console.log('open'));
  ws.on('close', (code) => { console.log('close ' + code); process.exit(code === 1012 ? 0 : 1); });
  ws.on('error', (err) => { console.log('error ' + err.message); process.exit(1); });
" >/dev/null
for _ in $(seq 1 20); do
  contains "$(docker logs "$WS" 2>&1)" '^open' && break
  sleep 0.5
done
contains "$(docker logs "$WS" 2>&1)" '^open' || fail "the CLI socket never opened: $(docker logs "$WS" 2>&1)"
step "a CLI socket is connected"

step "image size: $(docker image ls "$IMAGE" --format '{{.Size}}')"
MEMORY=$(docker stats --no-stream --format '{{.MemUsage}}' "$APP" | cut -d/ -f1 | tr -d ' ')
step "idle memory: $MEMORY"
MEMORY_MIB=$(echo "$MEMORY" | awk '/GiB$/ { print int($0 * 1024); next } /MiB$/ { print int($0); next } /KiB$/ { print 0; next } { print 99999 }')
[ "$MEMORY_MIB" -lt "$MEMORY_LIMIT_MIB" ] || fail "idle memory $MEMORY is over ${MEMORY_LIMIT_MIB} MiB"

step "docker stop (SIGTERM)"
START=$(date +%s)
docker stop -t 10 "$APP" >/dev/null
ELAPSED=$(( $(date +%s) - START ))
EXIT_CODE=$(docker inspect -f '{{.State.ExitCode}}' "$APP")
[ "$EXIT_CODE" = "0" ] || fail "the server exited with $EXIT_CODE after SIGTERM, not 0 (137 means Docker had to kill it)"
[ "$ELAPSED" -lt 10 ] || fail "the server took ${ELAPSED}s to stop"
step "stopped with exit code 0 in ${ELAPSED}s"

WS_EXIT=$(docker wait "$WS")
[ "$WS_EXIT" = "0" ] || fail "the CLI socket did not close with 1012: $(docker logs "$WS" 2>&1 | tr '\n' ' ')"
step "the CLI socket closed with 1012"

step "starting the same container again (migrations already applied)"
docker start "$APP" >/dev/null
wait_healthy
contains "$(docker logs "$APP" 2>&1)" 'No pending migrations to apply' || fail "the second start did not find the migrations already applied"
step "/healthz answers after the restart"

echo "image-smoke: PASS"
