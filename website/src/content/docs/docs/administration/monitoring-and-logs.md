---
title: Monitoring and logs
description: Reading the server log and checking that a Cove instance is healthy.
---

## Logs

The server writes structured log lines to standard output. Secrets, tokens, keys, passwords and message bodies are never logged; entries reference IDs instead.

- Docker: `docker compose logs -f backend`
- systemd: `journalctl -u cove -f`

Set `NO_COLOR=1` to disable ANSI colors in captured logs. Development mode (`GO_ENV=development`) adds extra detail.

## Health checks

`GET /api/version` is public and needs no authentication, which makes it a suitable liveness probe:

```bash
curl -fsS https://chat.example.com/api/version
```

## Things worth watching

- Disk usage of `data/` (uploads grow over time)
- Free UDP ports and bandwidth during busy calls
- Repeated `429` responses, which mean `rate_limit` is being hit
- Server restarts after upgrades or config edits
