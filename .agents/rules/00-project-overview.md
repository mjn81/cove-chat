---
trigger: always_on
description: Cove project overview, priorities, and agent workflow rules. Read first.
---

# Cove — Project Overview & Agent Workflow

You are an expert full-stack engineer working on **Cove**, a self-hosted, server-trusted encrypted chat platform. Follow these rules strictly. Where an existing file contradicts a rule, **new and touched code follows the rule**; do not mass-refactor untouched code unless asked.

## Repository map

| Path | What it is | Priority |
|---|---|---|
| `backend/` | Go 1.25 server: REST (`net/http` ServeMux), WebSocket hub, WebRTC SFU (`internal/rtc`), UDP voice, BadgerDB (encrypted at rest) | **Primary** |
| `client-web/` | React 19 + Vite + TypeScript + Tailwind 3 + Shadcn + React Query + Zustand + i18next | **Primary** |
| `client-android/` | Native Android client: Kotlin + Jetpack Compose + Stream WebRTC + Ktor + AES-256-GCM | Secondary |
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

## Calling & Media Architecture (Do not confuse)

- **Default = WebRTC SFU (`backend/internal/rtc`)**:
  - Group audio/video calling and screen sharing default to the in-process **WebRTC SFU** (`voice.mode = "webrtc"` in `config.toml`).
  - Media is encrypted via DTLS-SRTP, with NAT traversal using embedded STUN/TURN.
  - Signaling runs over the authenticated WebSocket hub (`internal/ws`).
  - Frontend uses `client-web/src/rtc/WebRTCManager.ts` with dual PeerConnections (publish + subscribe).
- **Air-Gapped / Isolated = Raw UDP (`backend/internal/voice`)**:
  - Reserved for air-gapped or restricted LAN deployments (`voice.mode = "raw_udp"`).
  - Audio-only, unencrypted UDP packet router on port `9090` without ICE/STUN/TURN overhead.
  - No video or screen sharing is supported in this mode.


## Branding (renamed from NodeTalk to Cove)

- User-facing name is **Cove**. On the web use `APP_NAME` from `client-web/src/lib/brand.ts`; never hard-code it.
- Logo sources live in `branding/` (`cove-mark.svg`, `cove-icon.svg`, PNGs). Palette: terracotta primary `#D9826A` (dark) / `#C4624A` (light) on warm neutrals; tokens in `client-web/src/index.css`, mirrored in `client-android/.../ui/theme/Color.kt`.
- **Deliberately unchanged technical identifiers** (renaming breaks existing installs/sessions/data): Go module `nodetalk/backend`, Android `applicationId`/package `com.nodetalk.client`, Wails `appID`, `nodetalk_*` cookies and localStorage keys, IndexedDB names (`NodeTalkDB`, `NodeTalkWhisperDB`), desktop config dir. Migrate these only as an explicit, planned task.
