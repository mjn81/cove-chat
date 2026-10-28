---
title: Build from source
description: Build the server and web client yourself with the project Makefile.
---

## Prerequisites

- Go 1.25
- Node 24 and pnpm (`corepack enable`; the version is pinned in `client-web/package.json`)
- `make`

## Build

```bash
git clone https://github.com/mjn81/cove-chat.git
cd cove-chat

make build            # server binary: ./cove-server
make front/install    # pnpm install --frozen-lockfile
make front/build      # web client: client-web/dist/
```

`make help` lists every target, including `test`, `lint`, `swagger`, `docker/build` and the Wails desktop builds.

## Run

```bash
cp backend/config.toml.example config.toml
./cove-server
```

Serve `client-web/dist/` with any static host. The web client reads its API address from `VITE_API_URL` at build time (the Docker image substitutes it at start instead).

## Release builds

`make release` builds the server for Linux, macOS and Windows plus the desktop apps, then zips them into `release/dist/`. See [Releasing](../../contributing/releasing/).
