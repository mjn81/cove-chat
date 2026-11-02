# Cove Client/Server API Standard

Normative rules for how every Cove client (web, desktop, Android) talks to a Cove server. The key words MUST, SHOULD and MAY are used as in RFC 2119. Reference code: `backend/internal/apistd` (constants, parsing), `backend/internal/middleware/clientversion.go` (enforcement), `client-web/src/lib/api-standard.ts`, Android `ApiStandard.kt`.

Goal: an old client never crashes or loses all access when the server gains features, and a new client degrades gracefully against an old server.

## 1. Versions

- `api_version` is a single **integer** describing the wire contract. It is bumped **only on a breaking change** (removing or re-typing a field, changing the meaning of a value, removing an endpoint or event). Additive changes MUST NOT bump it. Current value: **1**.
- The app version is separate semver (`0.9.9`). It identifies a build; it is never used to decide whether a feature exists (use capabilities, section 6).

## 2. Headers

| Header | Direction | Value |
|---|---|---|
| `X-Cove-Client` | client -> server, every request | `<platform>/<semver> (api <n>)`, e.g. `web/0.9.9 (api 1)`. Platforms: `web`, `desktop`, `android`. |
| `X-Cove-API-Version` | server -> client, every response (including errors and 404) | integer |
| `X-Cove-Server-Version` | server -> client, every response | server semver |
| `X-Cove-Client-Outdated` | server -> client | `1` when the caller is below `min_client_version` and the server only warns |

- Clients MUST send `X-Cove-Client`. Servers MUST tolerate it being absent or malformed (old clients, curl) and MUST NOT fail the request because of it, except under a hard minimum (section 7).
- Clients SHOULD read `X-Cove-API-Version`: a server `api_version` higher than the client's means the client may miss features (soft banner); lower means the server may lack features (gate on capabilities).

## 3. Version endpoint

`GET /api/version` is public, never blocked by the minimum-client check, and MUST keep its legacy fields.

```json
{
  "version": "0.9.9",
  "udp_port": 9090,
  "api_version": 1,
  "min_client_version": "0.9.0",
  "capabilities": ["invite_messages", "whisper", "webrtc_sfu"]
}
```

`min_client_version` is `""` when the admin set none. Fields are only ever added.

## 4. Error envelope

Every non-2xx JSON response MUST be:

```json
{ "error": "<human message or i18n key>", "code": "<stable_machine_code>", "details": { } }
```

- `error` is for people; clients MAY show it. It can change between releases. Clients MUST NOT branch on it.
- `code` is for programs; it is stable. Clients branch on it. A client that sees an unknown code MUST fall back to the HTTP status.
- `details` is optional and code-specific (for example `min_client_version`).
- When a handler gives no code, the server derives one from the status (501 maps to `feature_unsupported`, 413 to `payload_too_large`).
- Every layer (handlers, auth, rate limiting, client-version check, WebSocket upgrade) writes the envelope through the same helper (`apistd.WriteError`), always as `application/json`. JSON request bodies are size-capped; an oversize body is a 413 `payload_too_large`, never silently truncated.

Registry (`backend/internal/apistd`):

| code | Typical status | Meaning |
|---|---|---|
| `client_outdated` | 426 | Client is below the enforced minimum. `details.min_client_version`. |
| `server_outdated` | any | Raised by a **client** when the server's `api_version` is below what it needs. |
| `feature_unsupported` | 400/501 | The server lacks a capability the request needs. |
| `unauthorized` | 401 | Missing/invalid session. |
| `forbidden` | 403 | Authenticated but not allowed. |
| `not_found` | 404 | Resource missing (also used to avoid leaking existence). |
| `validation_failed` | 400/422 | Bad input. |
| `rate_limited` | 429 | Slow down. |
| `conflict` | 409 | State conflict (duplicate, stale). |
| `payload_too_large` | 413 | Body or file over a limit. |
| `method_not_allowed` | 405 | Wrong HTTP method. |
| `service_unavailable` | 503 | Temporarily down. |
| `internal` | 5xx | Server fault; details are logged, never returned. |

New codes are additive. Never reuse or repurpose a code.

## 5. Additive-change rules (forward compatibility)

- New JSON fields, new endpoints, new WebSocket events and new message types are **non-breaking**.
- Clients MUST ignore unknown JSON fields, and tolerate missing optional fields and unknown enum values.
- Clients MUST ignore unknown WebSocket event types (no crash, no disconnect).
- Clients MUST render an unknown message type as a placeholder card ("This message needs a newer version of Cove") instead of failing; the message keeps its place in the timeline.
- Servers MUST accept requests with missing optional fields and ignore unknown ones, and MUST ignore unknown WebSocket event types from clients (logged at Debug; the connection stays open).
- A change that cannot satisfy these rules is breaking: bump `api_version` and follow section 8.

## 6. Capabilities

The server advertises `capabilities: string[]` in `/api/version` and in the WebSocket `hello` event. Clients gate UI on `capabilities.includes("x")`, never on version comparisons. A client MUST treat a missing `capabilities` field (old server) as "none of the optional features", and unknown capability names as irrelevant.

Current names: `invite_messages` (invite cards in chat), `whisper` (E2EE whisper chats), `webrtc_sfu` (WebRTC group calls and screen share), `raw_udp_voice` (audio-only UDP calls, air-gapped mode).

## 7. Minimum client version

Server config (`[server]`): `min_client_version = "0.9.0"` and `enforce_min_client = false` (default).

- **Soft** (`enforce_min_client = false`): the server never rejects. It advertises `min_client_version`; a known client below it gets `X-Cove-Client-Outdated: 1`. Clients show a dismissible banner ("Your Cove is out of date, some features are unavailable") and stay usable.
- **Hard** (`enforce_min_client = true`): requests from a client below the minimum, or with no `X-Cove-Client` at all, get **HTTP 426** with `code: "client_outdated"` and `details.min_client_version`. Clients show a blocking screen that explains the problem and offers Reload (web) or an update link (desktop, Android).
- Never blocked, even when hard: `GET /api/version`, `GET /api/server-info`, anything outside `/api/` (static files), CORS preflights, and the WebSocket upgrade (its `hello` event carries the same data). `/api/login` and the other routes do return 426, so the login screen can show the explanation.

## 8. WebSocket handshake

The first frame on every connection is `hello`: `{ "type": "hello", "payload": { "version", "api_version", "min_client_version", "capabilities" } }`, the same block as `/api/version`. Clients MAY use it instead of an extra request. Clients that predate it ignore it (section 5).

## 9. Pagination

Bounded small lists return a JSON array. Unbounded lists return `{ "items": [...], "next_cursor": "<opaque>" }`; `next_cursor` is absent or empty on the last page. Clients treat the cursor as opaque.

## 10. Deprecation policy

A field, endpoint, event or code is first marked **deprecated** (Swagger `@Deprecated`, release notes, and this document) and keeps working for **at least 3 minor releases** before removal. Removal is a breaking change: bump `api_version` and, if old clients would break, raise `min_client_version` in the same release notes.

## 11. Checklist: adding an endpoint, event or message type

1. Additive only? New fields optional, new events/types ignorable by old clients. If not, it is breaking (section 10).
2. Pick or add a registry code for each realistic failure; use `writeError` / `writeErrorCode`.
3. Swagger block with `**Access:**` line; run `make swagger`.
4. New optional feature? Add a capability name in `apistd`, advertise it, and gate the UI on it.
5. New message type? Make sure web and Android render the placeholder for it on older builds (they do by default; add a real renderer for the new build).
6. New WebSocket event? Old clients ignore it; do not rely on it for correctness.
7. Backend test in `backend/tests/`; client tests for any parsing logic.
8. Only bump `api_version` for a breaking change, and update this document.
