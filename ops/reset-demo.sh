#!/usr/bin/env bash
# Nightly demo reset: wipe all data, restart and recreate the owner account plus a welcome channel.
# Run from cron on the server (see ops/README.md). Needs ops/instances/demo/.env and a deployed demo.
set -euo pipefail
cd "$(dirname "$0")"

dir="instances/demo"
# shellcheck source=/dev/null  (.env exists only on the server)
set -a; . "$dir/.env"; set +a
tag="$(cat "$dir/.last-good")"
export INSTANCE=demo TAG="$tag"
compose() { docker compose --env-file "$dir/.env" -f docker-compose.yml "$@"; }

compose down --volumes
compose up -d

for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' cove-demo-server 2>/dev/null)" = healthy ] && break
  sleep 4
done

# Talk to the server from inside its own container: no public route, so the per-IP signup limit and
# Turnstile do not apply to the seed. The first account on a fresh server becomes the owner.
run() { docker exec -i cove-demo-server wget -qO- --header='Content-Type: application/json' --post-data="$2" "http://127.0.0.1:4000$1"; }
run /api/register "{\"username\":\"$DEMO_OWNER_USER\",\"password\":\"$DEMO_OWNER_PASSWORD\"}" >/dev/null
login="$(run /api/login "{\"username\":\"$DEMO_OWNER_USER\",\"password\":\"$DEMO_OWNER_PASSWORD\"}")"
token="$(printf '%s' "$login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[ -n "$token" ] || { echo "seed login failed"; exit 1; }
docker exec -i cove-demo-server wget -qO- --header='Content-Type: application/json' --header="Authorization: Bearer $token" \
  --post-data='{"name":"welcome","description":"Say hi. This demo resets every night.","is_private":false,"members":[]}' \
  http://127.0.0.1:4000/api/channels >/dev/null
echo "Demo reset and seeded on $tag"
