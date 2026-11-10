# Plan: Bot API

Status: **design, written before implementation.** Follows the style of `themes-emoji-stickers-plan.md`. Everything is additive in the sense of `docs/api-standard.md` (no `api_version` bump); the feature is advertised as capability `bots`.

Goal: third parties (and server admins) can run bots on a Cove server the way they do on Discord and Telegram: a bot account with a token, slash commands, a gateway/webhook that delivers events, and rich UI (inline buttons, a keyboard-replacing action menu) in the chat.

## 0. Decisions

| # | Decision | Choice | Why / trade-off |
|---|---|---|---|
| 1 | What is a bot | A `User` with `kind = "bot"` plus a `Bot` record (owner, token hash, scopes, webhook). No password, cannot log in, cannot hold a session cookie. | Reuses the user id space, avatars, `uc:` memberships, message `sender_id` and every existing renderer. Cost: every place that lists users must know about `is_bot` (BOT badge, no friend requests, no DMs from the bot side). |
| 2 | Who may create bots | Setting `bots.creation` = `admins` (**default**) \| `users` \| `disabled`, live-editable in the admin panel. Per-user cap `bots.max_per_user` (default 5, admins exempt from nothing: they are capped too, owner excepted). | Safer default: a server operator opts in to letting every user run code that sees chat. Flagged in the final report as the user's call. |
| 3 | Token | `Authorization: Bot <bot_id>.<secret>`; secret is 32 random bytes, base64url. Only `sha256(secret)` is stored (a 256-bit random secret does not need a slow hash). Shown **once** at creation/rotation. Rotate = new secret, old one dies immediately and the bot's gateway connections are closed. Revoke/disable = same without a new secret. Compared in constant time. | Same hashing idea as `auth.SessionStore` (token hash at rest). The `<bot_id>.` prefix makes the lookup O(1) and lets secret scanners match the shape. |
| 4 | RBAC tier | New tier **Bot** in the access table: `Authorization: Bot <token>` only, resolved by `protectBot(...)`. `Sessions.Require` keeps accepting only `Bearer`/cookie, so **a bot token can reach nothing that is not explicitly wrapped in `protectBot` or `protectBotChannel`** (deny by default). A user session never satisfies `protectBot`. | Both directions are tested: bot token on a user route is 401, user token on a bot route is 401. |
| 5 | Bot permissions in a channel | A bot is always a plain channel **member** (`RoleMember`), never admin/owner, no matter what. Capability is controlled by **scopes** granted at install time by a channel admin: `messages.read` (see all message content, not just mentions), `messages.send` (default), `members.read`. No moderation scopes in v1. | No privilege escalation by construction: nothing a bot does is authorised by a role, only by an explicit scope, and the strongest scope is "read the channel". Trade-off: no moderation bots until a later `members.manage`. |
| 6 | Install | A channel **admin or owner** installs a bot into a group channel: `PUT /api/channels/{id}/bots/{bot_id}` with the scopes. Installing creates the bot's membership and a `BotInstall` row. Only bots that are `public` (listed) or owned by the installer can be installed; admins of the server can install any. Uninstall removes both. Bots are never added through the normal add-member route (rejected with `bot_install_required`) and never join through invite links. | One explicit, audited consent step per channel. |
| 7 | Bot DMs | A user may open a DM with a bot (normal `POST /api/channels` with the bot as the only other member); that records a `BotContact` (`bc:{bot}:{user}`). Interacting with a bot (command, button) also records one. A bot may only message a user who has a `BotContact` with it, and may not create a channel with a user otherwise: `POST /api/bots/@me/dm` is 403 `bot_contact_required`. Users can block a bot with the existing block action. | "Bots cannot DM users who have not interacted." |
| 8 | Encryption | **Server-side crypto for bots.** The bot sends and receives plaintext over TLS; the server encrypts/decrypts with the channel key, which it already holds (server-trusted model). The bot **never receives the channel key**; this is stricter than "key only for installed channels" and removes the need for every bot SDK to implement AES. The server only decrypts for channels where the bot is installed, and only delivers what scopes allow. Whispers never involve bots (bots cannot be whisper participants; `whisper_init` already needs friendship and bots cannot be friends). | The message bodies of installed channels are readable by the bot owner's code, and, for webhook bots, travel to the owner's HTTPS endpoint. That is the intended deal and the UI says so in the install dialog. Plaintext is never logged (only ids). |
| 9 | Rich messages | New message type `bot` (additive; old clients show the existing "needs a newer version" placeholder card). Plaintext body is versioned JSON `{v:1, text, buttons:[[{label,style,custom_id\|url}]], embed?}`, encrypted like any message, **validated by the server when the bot sends it**. Plain bot text uses type `text`. Only the author bot can edit; users cannot edit it. | Old clients lose a bot's buttons but never crash. Keeping plain text as `text` keeps search/notifications working. |
| 10 | Gateway | A **separate** WebSocket at `/gateway/bot` (mounted next to `/ws`, same origin/rate-limit wrap), authenticated by `Authorization: Bot`. Not the user hub: different auth, different payloads (plaintext), different rate limits, and bots must never see presence/key/whisper/call events. The hub and REST handlers publish into a small `bots.Dispatcher`. | Keeps the user socket protocol untouched. Cost: one more listener to harden; it reuses the existing origin and per-IP limiter wrappers. |
| 11 | Webhook delivery | Optional per bot: `webhook_url` (HTTPS only; `http://` only for loopback when `server.dev`) + auto-generated `webhook_secret`. Events are POSTed as JSON with `X-Cove-Signature: sha256=<hex HMAC of "<timestamp>.<body>">` and `X-Cove-Timestamp`, 5 s timeout, retries with exponential backoff (1 s, 5 s, 30 s, 5 min; at most 5 attempts), `X-Cove-Delivery` id for dedupe. SSRF guard: the resolved IP must not be private/loopback/link-local unless the admin set `bots.webhook_allow_private`. A bot with a connected gateway session gets events there; otherwise via webhook. The retry queue is in memory (ephemeral by design: bounded, per bot; lost on restart; documented). | HTTP-only bots (serverless) are supported without us building a durable job queue. |
| 12 | Slash commands | Discord-style: bots register commands (`name`, `description`, typed `options` with `choices`, `required`, bounds). **Global** (all channels the bot is installed in) or **per-channel**. Static choices only in v1; dynamic autocomplete is deferred. Typing `/` in the composer opens an autocomplete of commands from the bots installed in the channel. Invoking sends an `interaction` to the bot, not a chat message. | The server validates the invocation against the registered definition, so a bot only ever sees well-typed input. |
| 13 | Interactions | One model for commands, button clicks and keyboard presses: `interaction` rows `{id, type, bot_id, channel_id, user_id, message_id?, data}` with a one-time token valid 15 minutes. The bot answers `POST /api/interactions/{id}/{token}/callback` with `message` (new message), `update_message` (edit the source message, for buttons), or `ack` (silent "thinking"; a follow-up message is allowed for 15 min). Ephemeral (only-the-clicker) replies are deferred. | Same shape as Discord interactions, which bot authors already know. |
| 14 | Reply keyboard / action menu | Server-side per `(channel, bot)` state: `PUT /api/channels/{id}/keyboard` (bot) sets `{rows:[[button]], placeholder, persistent, one_time}`, `DELETE` removes it. Members get it as `keyboard_update` over their websocket and from `GET /api/channels/{id}/keyboards`. The web composer **replaces the text input area with the button grid** while one is active (a toggle button swaps back to typing; `persistent` keeps the toggle visible, `one_time` hides it after the first press). A press is an interaction of type `keyboard`. | Server-side state means it survives reloads and new devices, unlike scanning history. Per-channel (all members see it) in v1; per-user targeting is deferred. |
| 15 | Glass buttons | A single token-driven class `bot-glass` (translucent `bg-background/40` + `backdrop-blur`, 1px `border-border/60`, subtle inset highlight) used **only** by bot message buttons and the action menu, light and dark, no new hard-coded colours (works with every theme because it only uses theme tokens). The project's flat rule stays everywhere else. | Explicit user request; scope limited so it cannot leak into normal UI. Falls back to a solid `bg-muted` when `backdrop-filter` is unsupported or the user prefers reduced transparency. |
| 16 | Limits | Per bot: 50 req/s sustained per token on REST (token bucket), 5 messages/s per channel, 100 commands, 25 options... see section 7. Everything is bounded and validated before touching the store. | |
| 17 | Audit | Admin audit log (`aud:`) gets `bot.create`, `bot.delete`, `bot.rotate_token`, `bot.disable`, `bot.enable`, `bot.install`, `bot.uninstall`, `bot.webhook_set`, plus `admin.bots.setting` changes already covered by config audit. Target is the bot id/name, never a secret. Also recorded for non-admin owners (the audit list shows the actor). | |

## 1. Data model (BadgerDB, via `internal/store`, one file per entity)

- `models.User`: new `Kind string` (`""` = human, `"bot"`) and `OwnerID string`. `IsBot` helper. Bot users have no `PwdHash`; `AuthenticateUser` and `Register` refuse them. They are hidden from `SearchUsers` unless public, are not addable as friends and not selectable in "add members".
- `bot:{id}` -> `models.Bot{ID, OwnerID, Name, Description, AvatarID, TokenHash, TokenCreatedAt, Public, Disabled, WebhookURL, WebhookSecret (sealed with the DEK, shown once), Intents/MaxScopes, CreatedAt}`.
- `botown:{owner}:{id}` -> secondary index for "my bots" and the per-owner cap.
- `bi:{channel}:{bot}` -> `BotInstall{Scopes, InstalledBy, InstalledAt}`; `bii:{bot}:{channel}` index for "where is this bot installed".
- `bc:{bot}:{user}` -> `BotContact{At}`.
- `bcmd:{bot}:{scope}:{name}` -> command definition (`scope` = `global` or the channel id).
- `bkb:{channel}:{bot}` -> `Keyboard{rows, placeholder, persistent, one_time, message_id?, updated_at}`.
- `bint:{id}` -> interaction (token hash, expiry 15 min, `responded` flag); swept lazily on read and by a periodic cleanup of expired rows.
- No in-memory substitute for persisted data. In-memory (documented as ephemeral): connected gateway sessions, the webhook retry queue, rate-limit buckets.

## 2. REST surface

All errors use `writeError`/`writeErrorCode`. New codes (additive): `bot_limit_reached` (409), `bot_install_required` (400/403), `bot_contact_required` (403), `bots_disabled` (403), `command_invalid` (400), `interaction_expired` (410 mapped to 404 `not_found`-family, documented), `webhook_url_invalid` (400). Swagger on every handler with `**Access:**`.

Management (human session; **Authenticated**, creation additionally gated by `bots.creation`; the owner or a server admin):

| Route | Access | Purpose |
|---|---|---|
| `POST /api/bots` | Authenticated (policy: admins/users) | create, returns the bot and the token **once** |
| `GET /api/bots` | Authenticated | paged list of my bots (admins: `?all=1`) |
| `GET /api/bots/{id}` | owner or admin | one bot |
| `PATCH /api/bots/{id}` | owner or admin | name, description, avatar, public, disabled, webhook url |
| `DELETE /api/bots/{id}` | owner or admin | delete bot, installs, commands, keyboards |
| `POST /api/bots/{id}/token` | owner or admin | rotate; returns the new token once |
| `GET /api/bots/discover` | Authenticated | paged public bots to install |
| `GET /api/channels/{id}/bots` | Channel Member | bots installed in the channel (+ scopes) |
| `PUT /api/channels/{id}/bots/{bot_id}` | Channel Admin | install with scopes |
| `DELETE /api/channels/{id}/bots/{bot_id}` | Channel Admin | uninstall |
| `GET /api/channels/{id}/commands` | Channel Member | commands usable here (global of installed bots + per-channel), for autocomplete |
| `GET /api/channels/{id}/keyboards` | Channel Member | active keyboards |
| `POST /api/channels/{id}/interactions` | Channel Member | user invokes a command / presses a button / keyboard key |

Bot API (`Authorization: Bot`, tier **Bot**; channel routes additionally require an install with the right scope, otherwise 404 so existence is not leaked):

| Route | Scope | Purpose |
|---|---|---|
| `GET /api/bots/@me` | - | the bot's own profile |
| `PUT /api/bots/@me/commands` (+ `GET`, `DELETE /{name}`) | - | register global commands (bulk replace) |
| `PUT /api/bots/@me/channels/{id}/commands` | install | per-channel commands |
| `GET /api/bots/@me/channels` | - | installed channels (paged) |
| `POST /api/bots/@me/channels/{id}/messages` | `messages.send` | send text / rich message |
| `PATCH/DELETE /api/bots/@me/channels/{id}/messages/{mid}` | `messages.send` | edit/delete **own** messages only |
| `GET /api/bots/@me/channels/{id}/messages` | `messages.read` | paged history (decrypted) |
| `GET /api/bots/@me/channels/{id}/members` | `members.read` | paged members (with `is_bot`) |
| `PUT/DELETE /api/bots/@me/channels/{id}/keyboard` | `messages.send` | action menu |
| `POST /api/bots/@me/dm` | contact | open a DM with a user who interacted |
| `POST /api/interactions/{id}/{token}/callback` | token | answer an interaction |

A bot reads the path `{id}` as a channel id and the resolver checks the install; there is no way to name another bot (`@me` only), so there is no IDOR on bot identity.

## 3. Gateway events (`/gateway/bot`)

First frame `hello` (heartbeat interval, session id, the bot's installs). Bot then sends `identify`-less: authentication is the handshake itself. Events (all envelope `{type, payload}`, plaintext content):

- `message_create`, `message_update`, `message_delete` (id only)
- `interaction_create` (command, button, keyboard)
- `member_join`, `member_leave` (member events never include keys)
- `bot_install`, `bot_uninstall` (the bot was added to/removed from a channel)

Filtering: a bot receives a message only when (a) it is installed in the channel, and (b) it has `messages.read`, **or** the message mentions the bot (`@name`), replies to one of its messages, or is in a DM with it. Never its own messages. Intents are therefore expressed as scopes, decided by the channel admin, not by the bot. The gateway client may send `{type:"subscribe", events:[...]}` to narrow further. Ping/pong keepalive, 1 MB read limit, one connection per bot unless `?shard=` (deferred; v1 allows up to 3 connections, events fan out to all, documented).

## 4. Slash commands, buttons, keyboards in the web client

- Composer: typing `/` at the start opens a popup (reuse the mention popup mechanics) listing commands from `GET /api/channels/{id}/commands` (cached by React Query, invalidated on `bot_install` events). Choosing a command shows its options as typed fields (string/integer/boolean/user/choice); submit posts an interaction. No fake chat message is created.
- `bot` messages render `text`, then rows of buttons (max 5 rows x 5). Callback buttons post an interaction and show a short pending state; URL buttons open through the existing safe-link handling (http/https only, `rel=noopener`). Disabled/expired states are handled.
- Action menu: while a `keyboard_update` is active for the channel the composer's input row is swapped for the button grid (with the placeholder text and a toggle to bring the keyboard back; `persistent` / `one_time` semantics above).
- BOT badge next to every bot name in the feed, member list and profile card (`is_bot` on the user/member DTOs). Strings in en/fa/ar, logical Tailwind classes, shadcn primitives, `lucide-react`.
- Management UI: Settings > Bots (my bots: create, token dialog shown once with copy, rotate, delete, webhook, public toggle) and a channel info tab "Bots" for admins (install with a scope consent dialog that states what the bot can read). Admin panel: the `bots.*` settings and a list of all bots.

## 5. Encryption and privacy (summary of decision 8)

1. Channel keys stay wrapped by the KEK; the bot never gets a key. The server decrypts only inside the bot endpoints and the dispatcher, never outside an install.
2. Install consent text tells the admin that the bot's owner will receive the messages that match the granted scopes in plaintext (and the owner's server, if it is webhook based).
3. Whispers: bots cannot be whisper peers; the whisper relay already requires friendship and bots cannot be friends.
4. DMs with a bot are normal server-trusted channels; the bot sees them (that is the point of a DM with a bot) and the DM header shows the BOT badge.
5. Logs carry bot ids, channel ids and event types only, never plaintext, tokens or webhook secrets. Tokens and webhook secrets are redacted from audit targets.
6. Federation: bots are local accounts only.

## 6. Security checklist

- Deny by default: `protectBot` is the only way a `Bot` credential is accepted; a unit test enumerates every route and asserts a bot token is refused on non-bot routes.
- No privilege escalation: bots are `RoleMember`; `UpdateMember`, `RemoveMember`, role routes reject bot targets and bot actors; bots cannot create bots, cannot install bots, cannot call `/api/admin/*`, cannot use user sockets.
- Input limits: name 2..32 `[a-z0-9_.-]`, description 400 runes, text 4000 runes per message, 5x5 buttons, label 80, `custom_id` 100 bytes, URL 2048 (http/https only), 100 commands per scope, 25 options, 25 choices, JSON body cap 1 MB, rich body cap 16 KB.
- Timing-safe token compare, uniform 401, token never in a URL (header only; the gateway accepts the header or the `cove-bot.<token>` WebSocket subprotocol for browsers).
- Rate limits: REST token bucket per bot (`bots.rate_limit_rps`, default 25), message send 5/s per bot per channel, gateway read limiter, webhook concurrency capped per bot, interaction callbacks one per token (second answer is 409).
- A bot never receives ciphertext, keys, presence, typing or user email-like data; members expose id, username, avatar, `is_bot` only.

## 7. Settings (admin panel `bots` group, live)

`bots.enabled` (bool, default true), `bots.creation` (`admins|users|disabled`, default `admins`), `bots.max_per_user` (1..50, default 5), `bots.webhook_allow_private` (bool, default false), `bots.rate_limit_rps` (1..500, default 25).

## 8. Capability and compatibility

`bots` capability (advertised in `/api/version` and `hello` once the feature is compiled in and `bots.enabled`). Clients hide bot UI without it. `is_bot` and the `bot` message type are additive; old clients show a placeholder. No `api_version` bump.

## 9. Delivery plan

1. **Backend (TDD, `backend/tests/`)**: models + store, tokens, `protectBot`, management endpoints, install, commands, interactions, messages, keyboards, dispatcher + gateway + webhook, limits, settings, capability, Swagger, audit.
2. **Web**: types/api/hooks, BOT badge, bot message renderer, composer autocomplete, keyboard-replacing action menu, glass style, settings UI, i18n en/fa/ar, tests.
3. **Docs and example**: `docs/bots-api.md`, website API reference and "build your first bot", roadmap entry, `examples/bot-go` (a small Go bot: `/ping`, a counter with buttons, a keyboard menu).
4. **Android parity**: listed as a follow-up unless time remains.

## 10. Deferred (explicitly out of v1)

Ephemeral interaction replies, dynamic autocomplete interactions, per-user keyboards, moderation scopes, sharding, a durable webhook queue, bot-to-bot message delivery controls, federation of bots, Android and desktop-native UI for buttons and the action menu (desktop gets the web UI for free).
