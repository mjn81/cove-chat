# Cove Bot API

How to build a bot for a Cove server: accounts and tokens, installing bots in channels, receiving events (gateway or webhook), slash commands, buttons and the keyboard-replacing action menu, and what the server guarantees about encryption and privacy. The wire rules of the rest of the API (error envelope, paging, capabilities) are in [api-standard.md](api-standard.md); the field-by-field reference is the Swagger output (`backend/docs/`, tag `bots` for management and `bot-api` for what a bot calls). The design and its trade-offs are in [design/bot-api-plan.md](design/bot-api-plan.md).

Everything here is **additive** (`api_version` is unchanged) and advertised as the capability **`bots`**.

## 1. Concepts

| Term | Meaning |
|---|---|
| **Bot** | An account of kind `bot`. It has a username, an owner and a token, no password, and never signs in to the web client. Its messages carry a **BOT** badge. |
| **Token** | `<bot_id>.<secret>`. Shown **once** when the bot is created or the token is rotated; only a hash is stored. Sent as `Authorization: Bot <token>`. |
| **Install** | A channel admin adds a bot to a group channel and grants **scopes**. The bot becomes an ordinary member (never an admin). |
| **Scope** | `messages.send` (default), `messages.read`, `members.read`. What the bot may read or do in that channel. |
| **Gateway** | A WebSocket (`/gateway/bot`) that pushes events to a connected bot. |
| **Webhook** | An HTTPS endpoint the server POSTs events to when the bot has no open gateway connection. |
| **Interaction** | A user action addressed to a bot: a slash command, a button press, an action-menu key. The bot answers it with a one-time token. |

Access tiers (see the RBAC table in the backend rules): `Authorization: Bot` is its own tier. A bot token is accepted **only** on the routes listed in section 6; it is refused (401) everywhere else, and a person's session is refused on those routes.

## 2. Getting a bot

Who may create bots is an admin setting, **`bots.creation`**: `admins` (default, server admins and the owner), `users` (every signed-in account) or `disabled`. `bots.enabled` switches the whole API off, `bots.max_per_user` (default 5) caps the bots per account, `bots.rate_limit_rps` (default 25) is the per-token request rate, and `bots.webhook_allow_private` (owner only, default off) lets webhooks target private addresses.

```http
POST /api/bots            (signed in)
{ "username": "pingbot", "description": "Replies to /ping", "public": false, "webhook_url": "" }

201 { "bot": { "id": "…", "username": "pingbot", … }, "token": "<id>.<secret>", "webhook_secret": "" }
```

- Names are 2-32 characters of `a-z 0-9 _ . -` (lower case only, so a bot cannot imitate a person) and must not be taken by any account.
- Lose the token? Rotate it: `POST /api/bots/{id}/token` returns a new one and the old one stops working at once, closing the bot's gateway connections. `PATCH /api/bots/{id}` with `disabled: true` does the same without a new token.
- The web client does all of this under **Settings > Bots**.

## 3. Authentication, errors, limits

- `Authorization: Bot <bot_id>.<secret>` on every bot request. Any malformed, unknown or wrong token is the same `401 unauthorized`. A disabled bot gets `403 forbidden`; a server with bots off gets `403 bots_disabled`.
- Errors use the standard envelope `{ "error", "code", "details" }`. Codes added for bots: `bots_disabled`, `bot_limit_reached` (409), `bot_install_required`, `bot_contact_required` (403), `command_invalid` (400), `webhook_url_invalid` (400), `interaction_expired` (404).
- A channel the bot has no access to is always **404**, never 403, so ids cannot be probed. A missing scope inside an installed channel is 403.

| Limit | Value |
|---|---|
| Requests per bot token | `bots.rate_limit_rps` per second, burst 2x (429 with `Retry-After`) |
| Messages per bot per channel | 5 per second |
| Message text | 4000 characters |
| Buttons on a message | 5 rows x 5, label 80 characters, `custom_id` 100 printable characters, URL 2048 (http/https only) |
| Action menu | 8 rows x 8, callback buttons only, placeholder 64 characters |
| Commands | 100 per scope, 25 options, 25 choices per option, names `a-z 0-9 _ -` up to 32 |
| Request body | 1 MB (commands 512 KB); rich message body 16 KB |
| Gateway connections | 3 per bot |
| Webhook queue | 200 deliveries per bot |
| Interactions | valid 15 minutes, two answers at most |

## 4. Installing a bot, scopes, DMs

`PUT /api/channels/{id}/bots/{bot_id}` with `{ "scopes": ["messages.send", "messages.read"] }` (channel admin). Public bots, the caller's own bots, or any bot for a server admin can be installed. `DELETE` uninstalls. Group channels only; a bot cannot be added through the member list or an invite link (`bot_install_required`).

| Scope | Lets the bot |
|---|---|
| `messages.send` | post, edit and delete **its own** messages; set the action menu; answer interactions |
| `messages.read` | receive every message of the channel and list its history. Without it the bot only receives messages that **mention** it (`@name`), **reply** to it, and everything in a **DM** with it, plus the interactions addressed to it |
| `members.read` | list the members (id, username, `is_bot` only) and receive `member_join` / `member_leave` |

A bot is always a plain member: it cannot kick, promote, ban or call any admin route.

**DMs and Explore.** Public bots are listed in **Explore > Bots** (`GET /api/bots/discover`, paged, searchable by name or description; private and disabled bots are never listed) with their description and `command_count`. Pressing **Message** calls `POST /api/bots/{id}/start`: the server opens (or finds) the DM, records the person as a **contact** and sends the bot a **`bot_start`** event, like Telegram's Start button. A person can also open a DM with a public bot (or one they own) like with any user. Starting, using one of its commands or buttons all make them a **contact**. A bot can write only to its contacts: `POST /api/bots/me/dm { "user_id" }` returns the DM channel, or `403 bot_contact_required` for someone who never used the bot. Blocking a bot (the normal block action) stops it from writing to that person. In a DM with a bot the person can **clear history** (`POST /api/channels/{id}/clear`: hides the messages for them only, the chat stays listed, DMs only, own side only, a bot token is refused) or **remove the conversation** (`DELETE /api/channels/{id}`, delete for me; Start in Explore brings the same DM back with the old messages still hidden). Bots cannot be befriended.

## 5. Events: gateway and webhook

### 5.1 Gateway

Connect a WebSocket to `/gateway/bot` with `Authorization: Bot <token>` (or, from a browser, the subprotocol `cove-bot.<token>`; tokens never go in the URL). Up to 3 connections per bot. The gateway is one-way: the bot acts through REST and the frames it sends are ignored. The server pings every 30 seconds.

Every frame is `{ "id", "type", "bot_id", "payload" }`. The first is `hello`:

```json
{ "type": "hello", "payload": { "session_id": "…", "heartbeat_ms": 30000, "bot": { "id": "…", "username": "pingbot", "is_bot": true }, "channels": ["<channel id>", …], "api_version": 2 } }
```

### 5.2 Webhook

Set `webhook_url` (HTTPS; plain `http://` only for loopback when the server runs with `server.dev`). The server generates a **signing secret** (`whsec_…`, shown once when it is created or rotated). While a bot has an open gateway connection events go there; otherwise they are POSTed to the webhook:

```
POST <webhook_url>
Content-Type: application/json
X-Cove-Event: message_create
X-Cove-Delivery: <uuid, the same on every retry>
X-Cove-Timestamp: <unix seconds>
X-Cove-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>

{ "id": "<delivery uuid>", "type": "message_create", "bot_id": "…", "payload": { … } }
```

Verify the signature over the **raw body** with a constant-time compare and reject timestamps older than a few minutes. Any 2xx is success. 5xx, 408, 429 and network errors are retried after 1 s, 5 s, 30 s and 5 minutes (five attempts in total); other 4xx are not. The retry queue is in memory and bounded; events are lost if the server restarts, so a bot that must not miss anything should use the gateway and re-read history with `messages.read` after a reconnect. Redirects are not followed and the address is checked **at connect time**: private, loopback, link-local and carrier-grade-NAT targets are refused unless the owner enabled `bots.webhook_allow_private`.

### 5.3 Events

| `type` | Payload | Sent to |
|---|---|---|
| `message_create` / `message_update` | `{id, channel_id, author{id,username,is_bot}, type, content, buttons?, reply_to_id?, sent_at, edited_at?, mentioned?}` | bots with `messages.read`, or when mentioned / replied to / in a DM |
| `message_delete` | `{channel_id, message_id}` | bots with `messages.read` |
| `interaction_create` | `{id, token, type, channel_id, message_id?, user{id,username}, data, expires_at}` | the addressed bot only |
| `member_join` / `member_leave` | `{channel_id, user{id,username,is_bot}}` | bots with `members.read` |
| `bot_install` / `bot_uninstall` | `{channel_id, scopes?}` | the bot that was added or removed |
| `bot_start` | `{channel_id, user{id,username}}` | the bot a person just started from Explore; `channel_id` is the DM, where the bot may write at once |

A bot never receives its own messages. `content` is the plaintext for `text` and `bot` messages and empty for files, voice, video, stickers and invites (the `type` still tells you what it was). `mentioned` is true when the message mentions the receiving bot or replies to one of its messages. Events for one channel arrive in order. Unknown events must be ignored (a newer server may send more).

## 6. REST endpoints for bots

All under `Authorization: Bot`. `{id}` is a channel id.

| Route | Scope | Purpose |
|---|---|---|
| `GET /api/bots/me` | - | the bot's own profile |
| `GET` / `PUT /api/bots/me/commands`, `DELETE /api/bots/me/commands/{name}` | - | global slash commands (PUT replaces the whole set) |
| `GET /api/bots/me/channels` | - | channels and DMs the bot is in, with its scopes (paged) |
| `PUT /api/bots/me/channels/{id}/commands` | install | commands for one channel only |
| `POST /api/bots/me/channels/{id}/messages` | `messages.send` | send a message |
| `PATCH` / `DELETE /api/bots/me/channels/{id}/messages/{mid}` | `messages.send` | edit or delete one of its own messages (403 for anyone else's) |
| `GET /api/bots/me/channels/{id}/messages` | `messages.read` | history, newest first, plaintext (paged) |
| `GET /api/bots/me/channels/{id}/members` | `members.read` | members (paged) |
| `PUT` / `DELETE /api/bots/me/channels/{id}/keyboard` | `messages.send` | show or remove the action menu |
| `POST /api/bots/me/dm` | contact | open a DM with a user who used the bot |
| `POST /api/interactions/{id}/{token}/callback` | token | answer an interaction |

Management (a person's session; the bot's owner or a server admin): `POST/GET /api/bots`, `POST /api/bots/{id}/start` (any signed-in person, public bots), `GET/PATCH/DELETE /api/bots/{id}`, `POST /api/bots/{id}/token`, `GET /api/bots/discover` (public bots), `GET /api/channels/{id}/bots`, `PUT/DELETE /api/channels/{id}/bots/{bot_id}`. Used by the web client: `GET /api/channels/{id}/commands`, `GET /api/channels/{id}/keyboards`, `POST /api/channels/{id}/interactions`.

## 7. Messages and buttons

```http
POST /api/bots/me/channels/{id}/messages
{ "text": "Pick one", "reply_to_id": "", "buttons": [ [ { "label": "Yes", "custom_id": "yes", "style": "primary" },
                                                        { "label": "Docs", "url": "https://example.com" } ] ] }
```

- Without `buttons` the message is a normal `text` message. With buttons it is a message of type **`bot`**: an encrypted JSON body `{"v":1,"text":"…","buttons":[[…]]}`. Older clients show their "needs a newer version" placeholder for it. People cannot send the `bot` type.
- A button is a **callback** (`custom_id`; pressing it creates an interaction for the bot) or a **link** (`url`, http/https only, opens in a new tab with `noopener`). `style` is `primary`, `secondary` or `danger`. The bot can edit the message (new text and buttons, or none) when an interaction comes in.
- Buttons and the action menu are drawn in a subtle translucent "glass" style that follows the active theme, in light and dark.

## 8. Slash commands

Register them (global, or per channel):

```http
PUT /api/bots/me/commands
{ "commands": [ { "name": "roll", "description": "Roll a die",
    "options": [ { "name": "sides", "description": "Number of sides", "type": "integer", "required": true,
                   "choices": [ { "name": "d6", "value": "6" }, { "name": "d20", "value": "20" } ] },
                 { "name": "note", "description": "Say something", "type": "string" } ] } ] }
```

Option types: `string`, `integer`, `number`, `boolean`, `user` (a user id; the web client resolves `@name`). Required options come first. Choices are fixed lists (dynamic autocomplete is not part of v1).

In the composer, typing `/` lists the commands of the bots installed in the channel; `/roll 20 note:"hello"` (positional or `name:value`) is parsed by the client and sent as an interaction, **not** as a chat message. The server validates it against your definition (types, required options, choices, unknown options), so the bot only sees well-typed input:

```json
{ "type": "interaction_create", "payload": {
  "id": "…", "token": "…", "type": "command", "channel_id": "…",
  "user": { "id": "…", "username": "alice" },
  "data": { "name": "roll", "options": { "sides": 20, "note": "hello" } }, "expires_at": "…" } }
```

Button presses and action-menu keys arrive the same way with `type: "button"` (plus `message_id`) or `"keyboard"` and `data: { "custom_id": "…" }`.

**Answer** with `POST /api/interactions/{id}/{token}/callback` (bot token **and** the interaction token):

| `type` | Effect |
|---|---|
| `message` | post a new message (`text`, `buttons`) |
| `update_message` | edit the message the button was on |
| `ack` | acknowledge silently; one follow-up `message` may come later |

The token lives 15 minutes and takes two answers; afterwards `404 interaction_expired`. If a bot is offline and has no webhook, the person who used the command is told so (`delivered: false` in the response of `POST /api/channels/{id}/interactions`).

## 9. The action menu (reply keyboard)

```http
PUT /api/bots/me/channels/{id}/keyboard
{ "rows": [ [ { "label": "Start", "custom_id": "start" }, { "label": "Stop", "custom_id": "stop", "style": "danger" } ] ],
  "placeholder": "Choose an option", "persistent": true, "one_time": false }
```

While it is active, the web composer **replaces its text input with the button grid** for every member of the channel. A header button switches back to typing; a `persistent` keyboard keeps a small toggle to bring the menu back, other keyboards stay closed until the bot sends a different one. `one_time` closes the menu after the first key press. `DELETE` removes it. Presses arrive as `keyboard` interactions. Live updates reach clients as the WebSocket event `keyboard_update` (`{channel_id, bot_id, keyboard | null}`); clients also read `GET /api/channels/{id}/keyboards`. Keyboards are per channel and shared by all members in v1.

## 10. Encryption and privacy

Cove's encryption is **server-trusted**: channel keys are generated, wrapped by the server key and handed to members by the server, and messages are encrypted by clients with them. Bots work like this:

- **A bot never receives a channel key.** It sends and receives **plaintext over TLS** and the server encrypts and decrypts with the channel key on its behalf, only for channels the bot is installed in (or a DM opened with it) and only what its scopes allow. Bot SDKs therefore need no cryptography.
- **What the owner of a bot can read.** Whoever runs the bot sees the plaintext of every message the install lets it see, and so does the server that hosts the bot if it uses webhooks. Install only bots you trust; the install dialog says so. Without `messages.read` a bot sees only what is addressed to it.
- **Whispers never include bots.** Whisper chats are end-to-end encrypted between two friends; the relay is not reachable from bot endpoints and bots cannot be befriended. The bot gateway never carries presence, keys or ciphertext.
- **Logs** hold bot ids, channel ids and event types only, never message text, tokens or webhook secrets. Audit entries (`bot.create`, `bot.delete`, `bot.rotate_token`, `bot.disable`, `bot.enable`, `bot.install`, `bot.uninstall`, `bot.webhook_set`) never contain a secret.
- Deleting a bot removes its account, installs, commands and keyboard; its past messages stay in the history.

## 11. Compatibility

`bots` is a capability: clients hide bot UI without it and servers without it simply lack the routes. `member_bots` (channel) and `is_bot` (users) are optional additive fields; the `bot` message type and the `keyboard_update` event are ignorable by older clients per the additive-change rules. Android and desktop-native clients do not render buttons or the action menu yet (the desktop app gets the web UI).
