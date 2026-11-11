# Cove Client/Server API Standard

Normative rules for how every Cove client (web, desktop, Android) talks to a Cove server. The key words MUST, SHOULD and MAY are used as in RFC 2119. Reference code: `backend/internal/apistd` (constants, parsing), `backend/internal/middleware/clientversion.go` (enforcement), `client-web/src/lib/api-standard.ts`, Android `ApiStandard.kt`.

Goal: an old client never crashes or loses all access when the server gains features, and a new client degrades gracefully against an old server.

## 1. Versions

- `api_version` is a single **integer** describing the wire contract. It is bumped **only on a breaking change** (removing or re-typing a field, changing the meaning of a value, removing an endpoint or event). Additive changes MUST NOT bump it. Current value: **2** (see section 12 for what changed in 2).
- The app version is separate semver (`0.9.9`). It identifies a build; it is never used to decide whether a feature exists (use capabilities, section 6).

## 2. Headers

| Header | Direction | Value |
|---|---|---|
| `X-Cove-Client` | client -> server, every request | `<platform>/<semver> (api <n>)`, e.g. `web/0.10.0 (api 2)`. Platforms: `web`, `desktop`, `android`. |
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
  "api_version": 2,
  "min_client_version": "0.10.0",
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
- For the user-facing handlers (channels, files, users, relationships, messages) `error` is an i18n key `apiErrors.<name>`, optionally followed by `: detail` (a limit, for example `apiErrors.file_too_large: 10`). Clients translate it from the `apiErrors` locale object and show any other text as-is. Older servers send plain English; the same rule covers them.
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
| `invite_not_allowed` | WebSocket | An `invite` message pointed at a channel the sender may not invite to (see section 8). |
| `sticker_invalid` | WebSocket | A `sticker` message names a pack, sticker or file that does not match, or a disabled pack (see section 8 and `docs/packs-api.md`). |
| `pack_not_found` | 404 | A sticker pack, sticker or custom emoji does not exist or is not visible to the caller. |
| `pack_limit_reached` | 409 | A user's pack quota (packs, stickers per pack, total size) is reached. |
| `emoji_name_taken` | 409 | Another custom emoji already uses the shortcode. |
| `pack_uploads_disabled` | 403 | The admin switched user sticker uploads off. |
| `image_invalid` | 400 | An uploaded sticker or emoji image is not an allowed raster image or is out of bounds. |
| `bots_disabled` | 403 | The admin switched the Bot API off. |
| `bot_limit_reached` | 409 | The account already owns the most bots the admin allows. |
| `bot_install_required` | 400/403 | A bot cannot be added like an ordinary member; it must be installed with scopes (see `docs/bots-api.md`). |
| `bot_contact_required` | 403 | A bot may only message users who used it first. |
| `command_invalid` | 400 | A slash command definition, or an invocation, does not match its definition. |
| `webhook_url_invalid` | 400 | A bot webhook URL is not an acceptable HTTPS address. |
| `interaction_expired` | 404 | A bot answered an interaction with an unknown, expired or used-up token. |
| `internal` | 5xx | Server fault; details are logged, never returned. |

New codes are additive. Never reuse or repurpose a code.

## 5. Additive-change rules (forward compatibility)

- New JSON fields, new endpoints, new WebSocket events and new message types are **non-breaking**.
- Clients MUST ignore unknown JSON fields, and tolerate missing optional fields and unknown enum values.
- Clients MUST ignore unknown WebSocket event types (no crash, no disconnect).
- Message types so far: `text`, `file`, `voice`, `video`, `invite` and `sticker` (body `{pack_id, sticker_id, file_id}`, validated by the server, never edited; see `docs/packs-api.md`) and `bot` (an encrypted JSON body `{v, text, buttons}` that only a bot can send and only that bot can edit; see `docs/bots-api.md`). Custom emoji are not a type: they travel as `:name:` in ordinary text.
- Clients MUST render an unknown message type as a placeholder card ("This message needs a newer version of Cove") instead of failing; the message keeps its place in the timeline.
- Servers MUST accept requests with missing optional fields and ignore unknown ones, and MUST ignore unknown WebSocket event types from clients (logged at Debug; the connection stays open).
- A change that cannot satisfy these rules is breaking: bump `api_version` and follow the deprecation policy (section 10).

## 6. Capabilities

The server advertises `capabilities: string[]` in `/api/version` and in the WebSocket `hello` event. Clients gate UI on `capabilities.includes("x")`, never on version comparisons. A client MUST treat a missing `capabilities` field (old server) as "none of the optional features", and unknown capability names as irrelevant.

Current names: `invite_messages` (invite cards in chat), `whisper` (E2EE whisper chats), `webrtc_sfu` (WebRTC group calls and screen share), `raw_udp_voice` (UDP calls, air-gapped mode), `raw_udp_media` (air-gapped calls use the encrypted UDP media protocol of `docs/udp-media.md`: audio, video and screen share, native clients only; web clients must disable call buttons). In `raw_udp` mode the server reports `raw_udp_voice` and `raw_udp_media` and not `webrtc_sfu`. `emoji_packs` (emoji styles at `/api/emoji/styles`), `custom_emoji` (`:name:` shortcodes, `/api/emoji/custom`), `stickers` (sticker packs and the `sticker` message type) and `animated_emoji` (the big single-emoji table at `/api/emoji/animated`) are described in `docs/packs-api.md`. `bots` means the Bot API exists (bot accounts, slash commands, interactive messages, the bot gateway); see `docs/bots-api.md`.

## 7. Minimum client version

Server config (`[server]`): `min_client_version` (empty = no minimum) and `enforce_min_client = false` (default). At the release that ships API version 2, the owner SHOULD set `min_client_version = "0.10.0"` (see `backend/config.toml.example`), so clients that predate the paged envelope are told to update. Enforcement stays off by default.

- **Soft** (`enforce_min_client = false`): the server never rejects. It advertises `min_client_version`; a known client below it gets `X-Cove-Client-Outdated: 1`. Clients show a dismissible banner ("Your Cove is out of date, some features are unavailable") and stay usable.
- **Hard** (`enforce_min_client = true`): requests from a client below the minimum, or with no `X-Cove-Client` at all, get **HTTP 426** with `code: "client_outdated"` and `details.min_client_version`. Clients show a blocking screen that explains the problem and offers Reload (web) or an update link (desktop, Android).
- Never blocked, even when hard: `GET /api/version`, `GET /api/server-info`, anything outside `/api/` (static files), CORS preflights, and the WebSocket upgrade (its `hello` event carries the same data). The upgrade still carries `X-Cove-API-Version` / `X-Cove-Server-Version` and counts against the same per-IP rate limit as the REST API. `/api/login` and the other routes do return 426, so the login screen can show the explanation.

## 8. WebSocket handshake

The first frame on every connection is `hello`: `{ "type": "hello", "payload": { "version", "api_version", "min_client_version", "capabilities" } }`, the same block as `/api/version`. Clients MAY use it instead of an extra request. Clients that predate it ignore it (section 5).

When the server refuses a chat message it tells the sender with `{ "type": "message_error", "payload": { "channel_id", "code", "error" } }` (additive; older clients ignore it). `invite` messages are validated: the body must hold a `code` that resolves to a group channel in which the sender is an active member, and an invite link (as opposed to a public channel's id) can only be shared by an admin or the owner. A malformed or unknown invite is `validation_failed`, a channel the sender may not invite to is `invite_not_allowed`, and nothing is stored in either case.

## 9. Pagination

Every list that can grow without bound returns the paged envelope `{ "items": [...], "next_cursor": "<opaque>" }`; `next_cursor` is absent or empty on the last page.

- Query: `limit` (default **50**, max **100**) and `cursor` (the previous page's `next_cursor`). A `limit` that is not an integer in 1..100, or a `cursor` the server did not issue (garbage, tampered, or taken from another endpoint), is rejected with **400** `validation_failed`.
- Clients treat the cursor as opaque, never build or parse one, and stop when `next_cursor` is empty. A cursor is only valid for the endpoint and the caller that got it.
- Ordering is part of each endpoint's contract and is documented in Swagger. Messages are **newest first**: the first page is the latest messages and `next_cursor` leads to older ones.
- Paged endpoints (api 2): `GET /api/channels/{id}/messages`, `GET /api/channels`, `GET /api/channels/explore`, `GET /api/channels/{id}/members`, `GET /api/users` (still at most 50 results in total), `GET /api/relationships`, `GET /api/relationships/incoming`, `GET /api/admin/invites`, `GET /api/admin/audit`.
- Left as bare arrays because they are bounded by design: `GET /api/sessions` (the caller's own devices) and `GET /api/admin/admins` (server admins).

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
9. **A new list endpoint MUST use the paged envelope** (section 9) unless it is bounded by construction (own devices, admins) and says so in its Swagger block: `{items, next_cursor}`, `limit` 1..100 default 50, opaque `cursor`, 400 `validation_failed` for a bad `limit`/`cursor`, a named response type in `types.go`, and the `limit`/`cursor` `@Param` lines. Use `pageParams`/`writePage` (`backend/internal/api/paging.go`) and `apistd.Paginate`. Never return a bare array for something users can grow.

## 12. Version history

### api_version 2 (breaking, app 0.10.0)

- Every unbounded list moved from a bare array (or an ad-hoc wrapper) to the paged envelope of section 9: messages, my channels, explore, channel members, user search, relationships, incoming requests, admin invites (was `{ "invites": [...] }`) and admin audit (was `{ "entries": [...] }`, silently cut at 200, now fully pageable).
- `GET /api/channels/{id}/messages`: `limit` is 1..100 (default 50, was 1..500 default 250) and the `before` parameter is replaced by the opaque `cursor`; the response carries `next_cursor` for the next older page.
- `DELETE /api/users/me` requires the caller's current password in the body (`{ "password": "..." }`): 400 without it, 403 `forbidden` when wrong, 429 after repeated failures.

**Migration.** There are no compatibility shims: an api 1 client reading these endpoints will misparse them. Clients read `items`, follow `next_cursor`, send the password when deleting an account, and send `(api 2)` in `X-Cove-Client`. Servers should set `min_client_version = "0.10.0"` when releasing it.
