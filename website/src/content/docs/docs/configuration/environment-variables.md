---
title: Environment variables
description: Variables read by the server and the web client container.
---

## Server

| Variable | Effect |
|---|---|
| `NODETALK_CONFIG` | Path to the config file, instead of `./config.toml` |
| `NODETALK_MASTER_PASSWORD` | Overrides `security.master_password`, so the secret can stay out of the file (12-factor style) |
| `NODETALK_BACKUP_PASSPHRASE` | Passphrase used by `nodetalk-server restore <file>` |
| `GO_ENV=development` or `NODE_ENV=development` | Development mode: extra logging and Swagger UI at `/api/docs/` |

## Web client container

| Variable | Effect |
|---|---|
| `VITE_API_URL` | Public URL of the API. Replaced inside the built JavaScript when the container starts |

Everything else is configured in `config.toml`. See the [reference](../reference/).
