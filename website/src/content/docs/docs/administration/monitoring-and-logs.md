---
title: Monitoring and logs
description: Reading the server log and checking that a Cove instance is healthy.
---

## Logs

The server writes structured log lines to standard output. Secrets, tokens, keys, passwords and message bodies are never logged; entries reference IDs instead.

- Docker: `docker compose logs -f backend`
- systemd: `journalctl -u cove -f`

Set `NO_COLOR=1` to disable ANSI colors in captured logs. Development mode (`GO_ENV=development`) adds extra detail.

## Recovering from a damaged database

A power loss or a killed process can leave one of the database's table files (`data/db/main/*.sst`) filled with zeros. The server then refuses to start and the log says `table file 000011.sst is damaged (it contains only zeros)`.

Stop the server and run one command. It drops only the damaged file, keeps a full copy of the original next to it, and leaves every other record and the encryption keys as they were:

```bash
./cove-server repair
```

With Docker:

```bash
docker compose stop backend
docker compose run --rm backend ./cove-server repair
docker compose up -d
```

Whatever lived only in the damaged file, usually the most recent changes, is lost. If you have an admin-panel backup and need those records back, restore it afterwards with `COVE_BACKUP_PASSPHRASE=... ./cove-server restore <file> --force`. A healthy database is reported as such and not touched.

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
