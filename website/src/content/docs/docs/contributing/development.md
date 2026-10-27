---
title: Development setup
description: Set up a local Cove development environment and find your way around the repository.
---

## Repository tour

| Path | What it is |
|---|---|
| `backend/` | Go server: REST, WebSocket hub, WebRTC SFU, BadgerDB |
| `client-web/` | React 19, Vite, TypeScript, Tailwind, Shadcn, React Query, Zustand |
| `client-android/` | Native Android client |
| `client-desktop/` | Wails desktop shell |
| `website/` | This site |
| `Makefile` | Single entry point for builds, tests and linting. Run `make help` |

## Run locally

```bash
make front/install
make dev          # backend and web client together
```

Or separately: `make dev-back` and `make dev-front`. The web client runs on `http://localhost:5173`, which matches the default `server.frontend_origin`.

## Conventions

- Use `make` targets rather than raw `go` or `pnpm` commands whenever one exists.
- The web client uses **pnpm only**. Do not commit `package-lock.json` or `yarn.lock`.
- Search for existing hooks, utilities and helpers before writing new ones.
- No mock data. If the UI needs an endpoint that does not exist, build the backend route first.

See [Testing and standards](../testing-and-standards/) before opening a pull request.
