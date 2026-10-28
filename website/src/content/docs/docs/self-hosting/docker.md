---
title: Docker and Compose
description: Run Cove with the published Docker images or build them from source.
---

Two images make up a deployment:

| Image | Contents | Port |
|---|---|---|
| `mjn81/cove-server` | The Go server | 4000 and the UDP ports |
| `mjn81/cove-webclient` | nginx serving the web client | 80 (mapped to 3000) |

## Production compose file

```yaml title="docker-compose.yml"
services:
  backend:
    image: mjn81/cove-server:latest
    ports:
      - "4000:4000"
      - "3478:3478/udp"
      - "50000-50100:50000-50100/udp"
      - "9090:9090/udp"
    volumes:
      - ./data:/app/data
      - ./config.toml:/app/config.toml
    restart: unless-stopped

  frontend:
    image: mjn81/cove-webclient:latest
    ports:
      - "3000:80"
    environment:
      - VITE_API_URL=https://chat.example.com
    depends_on:
      - backend
    restart: unless-stopped
```

- `./data` holds the database and uploads. **Back it up.**
- `./config.toml` is your configuration. Start from [`config.toml.example`](../../configuration/reference/).
- `VITE_API_URL` is substituted into the web client at container start, so one image works for any domain.

## Pin versions

`latest` is convenient for a trial. In production pin a release tag and upgrade deliberately. See [Upgrading](../upgrading/).

## Environment variables

You can keep secrets out of `config.toml`:

```yaml
    environment:
      - COVE_MASTER_PASSWORD=${COVE_MASTER_PASSWORD}
```

See [Environment variables](../../configuration/environment-variables/) for the full list.

## Building the images yourself

From a clone of the repository, the root `docker-compose.yml` builds both images from source:

```bash
docker compose up -d --build
```
