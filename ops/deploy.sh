#!/usr/bin/env bash
# Deploy a tag to one instance on this server, with an automatic rollback.
# Usage: ops/deploy.sh <demo|staging> <tag>      (tag without the leading v, for example 0.9.1)
set -euo pipefail

instance="${1:?usage: deploy.sh <demo|staging> <tag>}"
tag="${2:?usage: deploy.sh <demo|staging> <tag>}"
cd "$(dirname "$0")"

dir="instances/$instance"
[ -f "$dir/.env" ] || { echo "missing ops/$dir/.env (copy .env.example and fill it in)"; exit 1; }
[ -f "$dir/config.toml" ] || { echo "missing ops/$dir/config.toml"; exit 1; }

compose() { docker compose --env-file "$dir/.env" -f docker-compose.yml "$@"; }
export INSTANCE="$instance"
last_good_file="$dir/.last-good"
previous="$(cat "$last_good_file" 2>/dev/null || true)"

healthy() {
  for _ in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "cove-$instance-server" 2>/dev/null)" = healthy ]; then return 0; fi
    sleep 4
  done
  return 1
}

echo "Deploying $instance at $tag (previous: ${previous:-none})"

# Public entry point: Caddy keeps running across deploys; this only applies a changed Caddyfile.
( cd proxy && docker compose up -d >/dev/null && docker exec cove-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null )

TAG="$tag" compose pull
TAG="$tag" compose up -d --remove-orphans

if healthy; then
  echo "$tag" > "$last_good_file"
  echo "OK: $instance is healthy on $tag"
  exit 0
fi

echo "Health check failed on $tag"
if [ -n "$previous" ]; then
  echo "Rolling back to $previous"
  TAG="$previous" compose up -d --remove-orphans
  healthy && echo "Rolled back to $previous" || echo "Rollback is also unhealthy: check 'docker logs cove-$instance-server'"
fi
exit 1
