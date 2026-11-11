---
title: API standard
description: The rules every Cove client and server follow so old clients keep working when the server grows, and the reverse.
---

This page is for people who build integrations or their own Cove client. It describes the contract between clients (web, desktop, Android) and the server. The key words MUST, SHOULD and MAY are meant as in RFC 2119. The per-endpoint list is in the [REST API reference](/docs/api/rest/).

The goal: an old client never crashes or loses all access when the server gains features, and a new client degrades gracefully against an old server.

## Versions

- `api_version` is one **integer** that describes the wire contract. It is raised **only on a breaking change** (removing or re-typing a field, changing what a value means, removing an endpoint or event). Additive changes never raise it. The current value is `2` (see [Version history](#version-history)).
- The app version is separate semver (for example `0.9.9`). It identifies a build. Do not use it to decide whether a feature exists; use [capabilities](#capabilities).

## Headers

| Header | Direction | Value |
|---|---|---|
| `X-Cove-Client` | client to server, every request | `<platform>/<semver> (api <n>)`, for example `web/0.10.0 (api 2)`. Platforms: `web`, `desktop`, `android` |
| `X-Cove-API-Version` | server to client, every response (errors and 404 included) | integer |
| `X-Cove-Server-Version` | server to client, every response | server semver |
| `X-Cove-Client-Outdated` | server to client | `1` when the caller is below `min_client_version` and the server only warns |

- Clients MUST send `X-Cove-Client`. The server tolerates it being absent or malformed (old clients, `curl`) and does not fail the request because of it, except under a [hard minimum](#minimum-client-version).
- A server `api_version` higher than the client's means the client may miss features (show a soft banner). Lower means the server may lack features (gate on capabilities).

## Version endpoint

`GET /api/version` is public, is never blocked by the minimum-client check, and keeps its original fields.

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

## Error envelope

Every non-2xx JSON response has this shape:

```json
{ "error": "<human message>", "code": "<stable_machine_code>", "details": {} }
```

- `error` is for people and can change between releases. Clients MAY show it and MUST NOT branch on it.
- For the user-facing handlers `error` is an i18n key `apiErrors.<name>`, optionally followed by `: detail` (for example `apiErrors.file_too_large: 10`). Clients translate it and show any other text as-is.
- `code` is for programs and is stable. A client that sees a code it does not know falls back to the HTTP status.
- `details` is optional and specific to the code (for example `min_client_version`).
- When a handler gives no specific code, the server derives one from the status.

| code | Typical status | Meaning |
|---|---|---|
| `client_outdated` | 426 | The client is below the enforced minimum. `details.min_client_version` is set |
| `server_outdated` | any | Raised by a **client** when the server's `api_version` is below what it needs |
| `feature_unsupported` | 400, 501 | The server lacks a capability the request needs |
| `unauthorized` | 401 | Missing or invalid session |
| `forbidden` | 403 | Signed in but not allowed |
| `not_found` | 404 | Resource missing (also used so existence is not leaked) |
| `validation_failed` | 400, 422 | Bad input |
| `rate_limited` | 429 | Slow down |
| `conflict` | 409 | State conflict (duplicate, stale) |
| `payload_too_large` | 413 | Body or file over a limit |
| `method_not_allowed` | 405 | Wrong HTTP method |
| `service_unavailable` | 503 | Temporarily down |
| `invite_not_allowed` | WebSocket | An `invite` message pointed at a channel the sender may not invite to |
| `sticker_invalid` | WebSocket | A `sticker` message names a pack, sticker or file that does not match, or a disabled pack |
| `pack_not_found` | 404 | A sticker pack, sticker or custom emoji does not exist or is not visible to the caller |
| `pack_limit_reached` | 409 | A user's pack quota (packs, stickers per pack, total size) is reached |
| `emoji_name_taken` | 409 | Another custom emoji already uses the shortcode |
| `pack_uploads_disabled` | 403 | The admin switched user sticker uploads off |
| `image_invalid` | 400 | An uploaded sticker or emoji image is not an allowed raster image or is out of bounds |
| `bots_disabled` | 403 | The admin switched the Bot API off |
| `bot_limit_reached` | 409 | The account already owns the most bots the admin allows |
| `bot_install_required` | 400/403 | A bot cannot be added like an ordinary member; it must be installed with scopes ([Bots](/docs/api/bots/)) |
| `bot_contact_required` | 403 | A bot may only message users who used it first |
| `command_invalid` | 400 | A slash command definition, or an invocation, does not match its definition |
| `webhook_url_invalid` | 400 | A bot webhook URL is not an acceptable HTTPS address |
| `interaction_expired` | 404 | A bot answered an interaction with an unknown, expired or used-up token |
| `internal` | 5xx | Server fault. Details are logged, never returned |

New codes are additive. A code is never reused for another meaning.

## Additive changes and forward compatibility

- New JSON fields, endpoints, WebSocket events and message types are **non-breaking**.
- Clients MUST ignore unknown JSON fields and tolerate missing optional fields and unknown enum values.
- Clients MUST ignore unknown WebSocket event types (no crash, no disconnect).
- Message types so far are `text`, `file`, `voice`, `video`, `invite`, `sticker` ([details](/docs/api/packs/#the-sticker-message)) and `bot` (buttons from a bot, [details](/docs/api/bots/#7-messages-and-buttons)). Custom emoji are not a type: they travel as `:name:` in ordinary text.
- Clients MUST show an unknown message type as a placeholder ("This message needs a newer version of Cove") and keep it in the timeline.
- The server accepts requests with missing optional fields, ignores unknown ones, and ignores unknown WebSocket event types from clients without closing the connection.
- A change that cannot follow these rules is breaking: raise `api_version` and follow the [deprecation policy](#deprecation-policy).

## Capabilities

The server lists the optional features it supports as `capabilities: string[]`, in `/api/version` and in the WebSocket `hello` event. Gate UI on `capabilities.includes("x")`, never on version comparisons. Treat a missing `capabilities` field (an old server) as "no optional features", and ignore names you do not know.

| Capability | Meaning |
|---|---|
| `invite_messages` | Invite cards in chat |
| `whisper` | End-to-end encrypted [Whisper](/docs/security/whisper/) chats |
| `webrtc_sfu` | WebRTC group calls and screen sharing (the default voice mode) |
| `raw_udp_voice` | UDP calls (the air-gapped voice mode, reported instead of `webrtc_sfu`) |
| `emoji_packs` | Emoji styles served by the server ([Emoji and stickers](/docs/api/packs/)) |
| `custom_emoji` | Custom emoji sent as `:name:` in ordinary text |
| `stickers` | Sticker packs and the `sticker` message type |
| `animated_emoji` | The table behind big animated single-emoji messages |
| `bots` | The Bot API: bot accounts, slash commands, interactive messages, the bot gateway ([Bots](/docs/api/bots/)) |
| `raw_udp_media` | Air-gapped calls use the encrypted UDP media protocol (audio, video, screen share) that only native clients speak; web clients disable call buttons |

## Minimum client version

Two keys in the `[server]` section of `config.toml` control it:

```toml
[server]
min_client_version = "0.9.0"
enforce_min_client = false   # default
```

- **Soft** (`enforce_min_client = false`): the server never rejects. It advertises `min_client_version`, and a known client below it gets `X-Cove-Client-Outdated: 1`. Clients show a dismissible banner and stay usable.
- **Hard** (`enforce_min_client = true`): a request from a client below the minimum, or with no `X-Cove-Client` header at all, gets **HTTP 426** with `code: "client_outdated"` and `details.min_client_version`. Clients show a blocking screen that explains the problem.
- Never blocked, even when hard: `GET /api/version`, `GET /api/server-info`, anything outside `/api/` (static files), CORS preflights and the WebSocket upgrade. Other API routes, including `/api/login`, do return 426, so the sign-in screen can explain what is wrong.

An empty `min_client_version` disables the check.

## WebSocket handshake

The first frame on every WebSocket connection is a `hello` event:

```json
{ "type": "hello", "payload": { "version": "0.9.9", "api_version": 2, "min_client_version": "0.10.0", "capabilities": ["invite_messages", "whisper", "webrtc_sfu"] } }
```

It carries the same block as `/api/version`, so a client can skip the extra request. Clients that predate it ignore it, as the rules above require.

When the server refuses a chat message it tells the sender with a `message_error` event (`channel_id`, `code`, `error`); older clients ignore it. An `invite` message must carry a `code` for a group channel in which the sender is an active member, and an invite link can only be shared by an admin or the owner. A malformed or unknown invite is `validation_failed`, a channel the sender may not invite to is `invite_not_allowed`, and nothing is stored.

## Pagination

Every list that can grow without bound returns an envelope:

```json
{ "items": [], "next_cursor": "<opaque>" }
```

`next_cursor` is absent or empty on the last page.

- Query parameters: `limit` (default 50, maximum 100) and `cursor` (the previous page's `next_cursor`). A `limit` outside 1 to 100, or a `cursor` the server did not issue (garbage, tampered with, or taken from another endpoint), gets `400` with code `validation_failed`.
- Treat the cursor as opaque: never build or parse one, and stop when `next_cursor` is empty.
- Ordering is part of each endpoint's contract. Messages are **newest first**: the first page holds the latest messages and the cursor leads to older ones.
- Paged endpoints: messages, your channels, channel explore, channel members, user search (at most 50 results in total), relationships, incoming friend requests, admin invites and the admin audit trail.
- Bounded by design and still plain arrays: your own devices (`GET /api/sessions`) and the server admin list.

## Deprecation policy

A field, endpoint, event or code is first marked **deprecated** (in Swagger, in the release notes and in the standard) and keeps working for **at least 3 minor releases** before removal. Removal is a breaking change: `api_version` goes up and, if old clients would break, `min_client_version` is raised in the same release notes.

## Version history

### api_version 2 (app 0.10.0)

A breaking release; the app is in beta and no compatibility shims were kept.

- Every unbounded list uses the [paged envelope](#pagination): messages, your channels, explore, members, user search, relationships, incoming requests, admin invites (formerly `{ "invites": [] }`) and the admin audit trail (formerly `{ "entries": [] }`, cut at 200 entries, now fully pageable).
- Messages: `limit` is 1 to 100 (default 50) and the `before` parameter is replaced by the opaque `cursor`.
- `DELETE /api/users/me` needs the current password in the body (`400` without it, `403` when wrong, `429` after repeated failures).

Migration: read `items`, follow `next_cursor`, send the password when deleting an account, and send `(api 2)` in `X-Cove-Client`. When you release this version, set `min_client_version = "0.10.0"` in `config.toml` so older clients are told to update.

## Checklist for contributors

When you add an endpoint, event or message type:

1. Keep it additive: new fields optional, new events and types ignorable by old clients. Otherwise it is a breaking change.
2. Use a registry code for each realistic failure.
3. Write the Swagger block with its `**Access:**` line and run `make swagger`.
4. For a new optional feature, add a capability name, advertise it and gate the UI on it.
5. For a new message type, check that web and Android show the placeholder on older builds.
6. Do not rely on a new WebSocket event for correctness; old clients ignore it.
7. Add a backend test in `backend/tests/` and client tests for any parsing logic.
8. Raise `api_version` only for a breaking change, and update the standard.
9. A new list endpoint must use the paged envelope above (named response type, `limit` and `cursor` parameters, `400 validation_failed` on bad input) unless it is bounded by construction.

The normative text lives in `docs/api-standard.md` in the repository; the reference code is `backend/internal/apistd` and `backend/internal/middleware/clientversion.go`.
