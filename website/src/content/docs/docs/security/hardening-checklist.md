---
title: Hardening checklist
description: Steps to take before exposing a Cove server to the internet.
---

- [ ] Serve everything over **HTTPS** ([Reverse proxy and TLS](../../self-hosting/reverse-proxy-tls/))
- [ ] Set `server.frontend_origin` to your exact web origin. Never use `*` in production
- [ ] Back up the **master password** and `data/` separately and test a restore
- [ ] Set `registration.mode` to `invite_only` or `closed` once your community has joined
- [ ] Keep `server.dev = false`, which hides the Swagger UI and extra logging
- [ ] Prefer `COVE_MASTER_PASSWORD` or a secrets manager over a world-readable `config.toml`
- [ ] Run the server as an unprivileged user with the data directory owned by that user
- [ ] Firewall: expose only 443 (or your proxy port) plus the UDP call ports you need
- [ ] Leave `rate_limit` enabled; lower `auth_rps` if you are attacked
- [ ] Pin container image tags and upgrade promptly when security fixes ship
- [ ] Limit who is an admin; the owner account should be yours
- [ ] Review the audit log in the admin panel occasionally
