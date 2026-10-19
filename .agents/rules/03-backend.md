---
trigger: glob
globs: backend/**
description: Go backend architecture, TDD, RBAC/access control, Swagger docs, logging, BadgerDB persistence, and API response format.
---

# Backend Architecture & Standards (`backend/`)

Stack: Go 1.25, standard `net/http` `ServeMux` (method+path patterns), BadgerDB v4 (encrypted at rest), `coder/websocket`, Pion WebRTC/TURN, swaggo for OpenAPI, module path `nodetalk/backend`.

## 1. Engineering approach — strict TDD

1. Write a failing test in `backend/tests/` that describes the behaviour (status codes, response body, DB side-effects, access denial cases).
2. Run `make test` and confirm it fails for the right reason.
3. Implement the minimum to pass; refactor with tests green.
4. Every handler change needs tests for: happy path, validation failure, **unauthenticated (401)**, and **insufficient role (403)** where applicable.

All tests live in the unified **`backend/tests/`** folder (package `tests`). Test through exported APIs (`api.NewRouter`, `store.Store`, `httptest`). Use a real BadgerDB in a `t.TempDir()` — don't mock the store. Don't commit `stress_report_*.txt` files.

## 2. Architecture (feature / domain oriented)

```
backend/
├── cmd/server/main.go         # wiring + Swagger general info (@title, @securityDefinitions)
├── internal/
│   ├── api/                   # HTTP handlers, one file per domain: auth.go, channels.go, messages.go, files.go, users.go, relationships.go
│   │   ├── handler.go         #   Handler deps + NewRouter (all routes registered here)
│   │   ├── types.go           #   request/response DTOs (used by Swagger)
│   │   └── utils.go           #   writeJSON / writeError and shared helpers
│   ├── auth/                  # sessions, cookies + CSRF, token resolution
│   ├── store/  db/            # repository layer over BadgerDB
│   ├── models/                # persisted data structures & role constants
│   ├── ws/                    # WebSocket hub & event handlers
│   ├── rtc/  voice/           # WebRTC SFU / TURN, UDP voice router
│   ├── crypto/                # Argon2id, AES-256-GCM, KEK/DEK
│   ├── middleware/            # CORS, rate limiting
│   ├── config/  logger/  storage/  federation/
└── tests/                     # ALL tests
```

- Add a new domain's handlers as `internal/api/<domain>.go`, its DTOs in `types.go` (or `types_<domain>.go` if large), and its persistence methods in `internal/store`.
- A large self-contained subsystem (like `rtc`) gets its own `internal/<feature>/` package.
- **Calling Architecture**:
  - `internal/rtc`: In-process WebRTC SFU (Pion) with DTLS-SRTP and embedded STUN/TURN for group video/audio and screen sharing. **This is the default (`voice.mode = "webrtc"`)**.
  - `internal/voice`: Raw UDP audio-only router on port `9090` without video or encryption. **Used exclusively for air-gapped/isolated setups (`voice.mode = "raw_udp"`)**.
- Handlers stay thin: decode → validate → authorize → call store/service → respond. Business rules that are reused go in the store/service layer, not copy-pasted between handlers.

## 3. Logging

- **Always use `nodetalk/backend/internal/logger`** (`logger.Info/Infof`, `Warn/Warnf`, `Error/Errorf`, `Debug/Debugf`, `Fatal/Fatalf`).
- **Never** `fmt.Print*`, `log.Print*`, `log.Fatal*`, or `println` for diagnostics. (Sole exception: the intentional master-password banner in `internal/config/config.go`.)
- Never log secrets, tokens, cookies, keys, passwords, or message plaintext/ciphertext bodies. Log IDs.

## 4. Access control (RBAC) — deny by default

Access tiers in this codebase, lowest → highest:

| Tier | How it's enforced | Router wrapper |
|---|---|---|
| **Public** | no auth (only `GET /api/version`, `POST /api/register`, `POST /api/login`) | `authLimiter.Limit(...)` or none |
| **Authenticated** | valid session cookie (+ CSRF on mutations) or Bearer token | `protect(...)` → `Sessions.Require` |
| **Channel Member** (`models.RoleMember = 0`) | membership of `{id}` channel | `protectMember(...)` → `RequireMember` |
| **Channel Admin** (`models.RoleAdmin = 10`) | `uc.Role >= models.RoleAdmin` check in handler | `protectMember(...)` + role check |
| **Channel Owner** (`models.RoleOwner = 20`) | `uc.Role >= models.RoleOwner` check in handler | `protectMember(...)` + role check |

Rules:
- **Every new route is at least `protect(...)`.** A route is public only if the user explicitly says so. If a role isn't specified, use the lowest authenticated tier — never leave a route unwrapped.
- Channel-scoped routes (`/api/channels/{id}/...`) use `protectMember`, then check the role in the handler. Prefer a shared helper for repeated role checks rather than copying `if uc.Role < models.RoleAdmin` blocks.
- Return **401** for missing/invalid auth and **403** for insufficient role. Never leak whether a resource exists to a non-member (prefer 403/404 consistently with existing handlers).
- Object-level checks: verify ownership/membership for every ID taken from the path or body (files, messages, members) — no IDORs.
- WebSocket and RTC signaling messages must apply the same membership/role checks as their REST equivalents.

## 5. Swagger — mandatory on every handler

Every handler has a complete swaggo block, and its access tier is stated explicitly. Regenerate with `make swagger` and commit `backend/docs/` alongside.

```go
// UpdateMember changes a member's role in a channel.
//
//	@Summary     Update a channel member's role
//	@Description Promotes or demotes a member. The owner's own role cannot be changed.
//	@Description **Access:** Channel Owner.
//	@Tags        channels
//	@Accept      json
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id   path string                  true "Channel ID"
//	@Param       uid  path string                  true "Target user ID"
//	@Param       body body UpdateMemberRequest     true "New role"
//	@Success     200  {object} StatusResponse
//	@Failure     400  {object} ErrorResponse
//	@Failure     401  {object} ErrorResponse
//	@Failure     403  {object} ErrorResponse
//	@Failure     404  {object} ErrorResponse
//	@Router      /api/channels/{id}/members/{uid} [patch]
```

- The `**Access:**` line is required on every handler: `Public`, `Authenticated`, `Channel Member`, `Channel Admin`, or `Channel Owner` (plus any extra condition, e.g. "self only").
- Public handlers write `**Access:** Public` and omit `@Security`.
- Use named DTO structs from `types.go` in `@Param`/`@Success`/`@Failure` — never inline anonymous request structs or `{object} map[string]any`. (Existing handlers that decode into an inline `var req struct{…}`, e.g. `UpdateMember`, should be moved to a named DTO when touched.)
- List every realistic failure status (400/401/403/404/409/413/429/500).

## 6. Persistence

- All persistent data goes through BadgerDB via `internal/store` / `internal/db`. **No in-memory maps or slices as a substitute for persisted data**, and no mocked DB calls in production code.
- In-memory structures are fine only for genuinely ephemeral runtime state (WS hub connections, presence, RTC rooms, rate-limiter buckets, caches with a DB source of truth) — document why when you add one.
- Data at rest stays encrypted with the DEK; channel keys stay wrapped by the KEK. Whisper (E2EE) content is never persisted.
- Multi-key updates use a single Badger transaction.

## 7. API response format

- JSON only, via `writeJSON(w, code, v)` / `writeError(w, code, msg)` in `internal/api/utils.go`. Don't call `json.NewEncoder(w)` directly in handlers.
- **Errors:** `ErrorResponse{"error": "<human-readable message>"}` with the correct HTTP status. The frontend shows this message to users, so make it clear and safe (no internals, stack traces, or DB errors — log those instead).
- **Mutations without a resource body:** `StatusResponse{"status": "success"}`; add a `message` field with a user-facing success message when the action warrants a toast.
- **Created resources:** `201` with the resource DTO.
- **Lists:** return a JSON array for small bounded lists (existing behaviour). For new unbounded lists (messages, search, explore) use cursor pagination with a consistent envelope, e.g. `{ "items": [...], "next_cursor": "..." }`, and document it in Swagger.
- Field names are `snake_case`; times are RFC3339 (`time.Time`); IDs are strings.
- Validate and bound all input (lengths, sizes, enum values) before touching the store; respect configured limits (`MaxFileSizeMB`, `MaxVideoSizeMB`, …).

## 8. Go style

- `make lint` (golangci-lint) must pass; `gofmt`-clean.
- Wrap errors with context (`fmt.Errorf("load channel %s: %w", id, err)`); don't swallow errors silently.
- Pass `context.Context` through long-running or cancellable operations.
- Any goroutine has a clear owner and shutdown path; run `make test` (race detector on) for concurrency changes.
