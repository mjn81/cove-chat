---
trigger: always_on
description: NodeTalk project overview, priorities, and agent workflow rules. Read first.
---

# NodeTalk — Project Overview & Agent Workflow

You are an expert full-stack engineer working on **NodeTalk**, a self-hosted, server-trusted encrypted chat platform. Follow these rules strictly. Where an existing file contradicts a rule, **new and touched code follows the rule**; do not mass-refactor untouched code unless asked.

## Repository map

| Path | What it is | Priority |
|---|---|---|
| `backend/` | Go 1.25 server: REST (`net/http` ServeMux), WebSocket hub, WebRTC SFU (`internal/rtc`), UDP voice, BadgerDB (encrypted at rest) | **Primary** |
| `client-web/` | React 19 + Vite + TypeScript + Tailwind 3 + Shadcn + React Query + Zustand + i18next | **Primary** |
| `client-desktop/` | Wails shell that embeds the `client-web` build | Secondary — only touch when explicitly asked |
| `Makefile` | The single entry point for all commands | — |

Related rule files (read the ones relevant to your task):

- `01-shared.md` — practices for the whole stack (Makefile, DRY, docs, comments, types)
- `02-frontend.md` — `client-web` architecture, UI, i18n/RTL, data fetching, forms
- `03-backend.md` — Go architecture, TDD, RBAC, Swagger, logging, persistence

## Agent workflow (non-negotiable)

1. **Never start dev servers yourself** (`make dev`, `make dev-back`, `make dev-front`, `go run`, `vite`, `pnpm dev`, browser previews). The user runs them. Verify with builds, type checks, linters, and tests instead. If you truly need a running server, ask the user to start it.
2. **TDD.** Write a failing test that captures the behaviour first, then implement until it passes. Applies to backend (mandatory) and to frontend pure logic (utils, stores, hooks).
3. **Use the Makefile** for every command it covers (`make test`, `make lint`, `make swagger`, `make tidy`, `make front/test`, `make front/lint`, `make front/typecheck`, `make front/build`, …). Run `make help` to list targets. Only fall back to a raw command when no target exists — and consider adding one.
4. **Search before you write.** Before creating any hook, API call, util, component, or Go helper, search the codebase for an existing one and reuse/extend it.
5. **No mock data, no fake endpoints.** If the frontend needs an endpoint that doesn't exist, stop and tell the user the backend route must be built first (or build it, backend-first, if that is in scope).
6. **Web + backend by default.** Desktop (Wails)–specific work is out of scope unless requested; note desktop impact instead of fixing it inline.

## Security model to preserve

- Server-trusted encryption: channel keys are generated, wrapped by the KEK, and distributed by the server. Messages are encrypted client-side (AES-256-GCM); the server stores/routes ciphertext.
- "Whisper" chats are zero-persistence E2EE — never persist their plaintext or keys server-side.
- Web auth = httpOnly `nodetalk_session` cookie + double-submit CSRF (`nodetalk_csrf` cookie → `X-CSRF-Token` header). Desktop (Wails) = Bearer token. Do not "unify" these; the split is intentional (see `internal/auth/auth.go`).
- Never log secrets, tokens, keys, plaintext message bodies, or passwords.
