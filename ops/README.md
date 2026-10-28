# Cove ops: demo and staging

Runbook for the shared server. The design and the reasoning are in `docs/design/release-and-demo-plan.md`.

Rules for this box: it also runs other projects. Only touch `cove-*` containers and volumes, add Cove proxy hosts to nginx-proxy-manager (NPM) and nothing else in it, and keep every Cove container under its CPU and memory cap.

## One-time setup (as the `deploy` user)

1. Copy `ops/` to `~/cove-ops` (the release workflow does this on every deploy).
2. For each instance, create its secrets file:
   ```bash
   cd ~/cove-ops/instances/demo && cp .env.example .env && chmod 600 .env && nano .env
   ```
   Use long random values for `COVE_MASTER_PASSWORD` and `DEMO_OWNER_PASSWORD`. Back the master password up: losing it makes the database unrecoverable.
3. Deploy once by hand to check it: `~/cove-ops/deploy.sh demo 0.9.1` (use a tag that has published images).

## NPM proxy hosts (once per instance, in the NPM admin UI)

The admin UI listens on the server's loopback only: `ssh -L 8181:127.0.0.1:81 ...` then open `http://localhost:8181`.

For `demo.covechat.dev` (and `staging.covechat.dev` with the `cove-staging-*` names):

1. Add a Proxy Host. Domain `demo.covechat.dev`, scheme `http`, forward host `cove-demo-web`, port `80`. Turn on Block Common Exploits.
2. SSL tab: request a new Let's Encrypt certificate, turn on Force SSL and HTTP/2.
3. Custom locations, both with scheme `http`, forward host `cove-demo-server`, port `4000`:
   - `/api`
   - `/ws` (also paste the Advanced field below so WebSocket upgrades and long calls survive)
   ```
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
   ```
4. Under the Details tab Advanced field, add per-IP request limiting if you want edge protection on top of the app's limits.

The containers join `proxy-network`, the network NPM already uses, so the names above resolve.

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
