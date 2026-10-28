# Cove ops: demo and staging

Runbook for the shared server. The design and the reasoning are in `docs/design/release-and-demo-plan.md`.

Rules for this box: it also runs other projects. Only touch `cove-*` containers and volumes, and keep every Cove container under its CPU and memory cap.

## One-time setup (as the `deploy` user)

1. Copy `ops/` to `~/cove-ops` (the release workflow does this on every deploy).
2. For each instance, create its secrets file:
   ```bash
   cd ~/cove-ops/instances/demo && cp .env.example .env && chmod 600 .env && nano .env
   ```
   Use long random values for `COVE_MASTER_PASSWORD` and `DEMO_OWNER_PASSWORD`. Back the master password up: losing it makes the database unrecoverable.
3. Deploy once by hand to check it: `~/cove-ops/deploy.sh demo 0.9.1` (use a tag that has published images).

## HTTPS and routing (Caddy)

Caddy (`cove-proxy`, config in `proxy/Caddyfile`) is the only thing on ports 80/443. It requests and renews Let's Encrypt certificates by itself; there is no panel. To add an instance:

1. Point its DNS record (DNS-only, not proxied) at the server.
2. Add a block to `proxy/Caddyfile`, for example for staging:
   ```
   staging.covechat.dev {
   	import cove_instance cove-staging-server:4000 cove-staging-web:80
   }
   ```
3. Run `~/cove-ops/deploy.sh staging <tag>`. The script reloads Caddy.

Check a certificate: `docker logs cove-proxy 2>&1 | grep -i certificate`. Validate a Caddyfile edit before deploying: `docker run --rm -v $PWD/proxy:/etc/caddy:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`.

The previous nginx-proxy-manager was stopped and archived at `/opt/backups/nginx-proxy-manager-2026-10-29.tgz`; its container still exists (not started) if you ever need it back.

## Demo reset

The demo wipes itself at 03:30 server time and recreates the owner and a `welcome` channel:

```bash
( crontab -l 2>/dev/null; echo '30 3 * * * ~/cove-ops/reset-demo.sh >> ~/cove-ops/reset.log 2>&1' ) | crontab -
```

## Rollback and inspection

- A failed deploy rolls back to the last healthy tag by itself (`instances/<name>/.last-good`).
- Manual rollback: `~/cove-ops/deploy.sh demo <older-tag>`.
- Logs: `docker logs --tail 100 cove-demo-server`. Resource use: `docker stats --no-stream cove-demo-server cove-demo-web`.
- Weekly cleanup of unused images (Cove only keeps what it needs): `docker image prune -af --filter "until=168h"` is safe here only if the other projects' images are all in use; check `docker ps -a` first.

## GitHub secrets for automatic demo deploys

Set the repository variable `DEPLOY_ENABLED=true` and these secrets (environment `demo`): `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_SSH_KEY` (a dedicated key authorized only for the `deploy` user), `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan -p <port> <host>`, checked once by eye). Without the variable the deploy job is skipped.
