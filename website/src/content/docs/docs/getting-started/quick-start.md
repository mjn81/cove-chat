---
title: Quick start
description: Run your own Cove server and web client with Docker in about five minutes.
---

This gets you a working server and web client on one machine. You need [Docker](https://docs.docker.com/get-docker/) with Compose.

## 1. Create a folder and fetch the files

```bash
mkdir cove && cd cove
curl -O https://raw.githubusercontent.com/mjn81/cove-chat/main/examples/docker-compose/production/docker-compose.yml
curl -o config.toml https://raw.githubusercontent.com/mjn81/cove-chat/main/backend/config.toml.example
mkdir data
```

## 2. Point the web client at your server

Open `docker-compose.yml` and set `VITE_API_URL` on the `frontend` service to the address people will use to reach the API, for example `https://chat.example.com:4000`. For a local trial the default `http://localhost:4000` works.

Then set `frontend_origin` in `config.toml` to the address of the web client (for example `http://localhost:3000`). The server only accepts browser requests from that origin.

## 3. Start it

```bash
docker compose up -d
```

| Port | Used for |
|---|---|
| `3000/tcp` | Web client |
| `4000/tcp` | API and WebSocket |
| `3478/udp` | Embedded STUN/TURN for calls |
| `50000-50100/udp` | WebRTC media |
| `9090/udp` | Raw UDP voice (only for `voice.mode = "raw_udp"`) |

## 4. Create the owner account

Open `http://localhost:3000` and register. **The first account on a fresh server becomes the owner.** Owners and admins get a *Server admin* tab in Settings.

:::caution[Back up your master password]
On first start the server generates a master password and writes it into `config.toml`. It encrypts the database key. If you lose it the data cannot be recovered. Copy it somewhere safe now.
:::

## Next steps

- Put it behind HTTPS: [Reverse proxy and TLS](../../self-hosting/reverse-proxy-tls/)
- Allow calls from outside your network: [Voice and calls](../../configuration/voice-and-calls/)
- Decide who can sign up: [Registration and invites](../../configuration/registration-and-invites/)
- Schedule backups: [Backups and restore](../../self-hosting/backups-restore/)
