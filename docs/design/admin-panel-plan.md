# Server admin panel - plan

Goal: a small admin panel, reachable from the web, desktop and Android clients, for the server creator and
people the creator trusts. Everything the panel can do must also be doable by editing `config.toml`.

## 1. Roles and access

| Role | How it is obtained | Can do |
|---|---|---|
| **Owner** | First account ever registered on a fresh server (decided atomically). Recovery: `[admin] owner_username` in config assigns the role to an existing user at startup. Can be handed over with "transfer ownership". | Everything below, plus: manage admins, backup, reset, delete, transfer ownership, owner-only config keys |
| **Admin** | Granted/revoked by the owner by username. | Overview, registration mode, invites, non-sensitive config, audit log |
| Everyone else | - | Nothing. The panel is not shown and every `/api/admin/*` route answers 403. |

Stored on the user as `server_role` (`""` | `"admin"` | `"owner"`). It is **never** accepted from a client
payload (`PATCH /users/me` ignores it) and is only returned to the user themself via `/api/me`; it is stripped
from every other user object (search, profile, member lists).

## 2. Security model (this is the part that must not be wrong)

1. **Server-side checks only.** The UI hides the panel for non-admins, but every route re-loads the caller from
   the database (no role caching in the session), so revoking an admin takes effect on the next request.
2. **Deny by default.** Routes are registered through `protectAdmin` (admin or owner) or `protectOwner`; there
   is no way to add an `/api/admin/*` route without one of them. A route test enumerates the router and fails
   if an admin path is unwrapped.
3. **Step-up for destructive actions.** Backup, reset, delete, transfer ownership, granting/revoking admins and
   changing owner-only config require the caller's current password in the request body (verified with Argon2id)
   and, for reset/delete, a typed confirmation phrase. Wrong password = 403 and counts against the auth rate limit.
4. **No secrets over the API.** `master_password`, `turn_shared_secret`, S3 keys and `database.path` are never
   readable or writable through the panel. Config editing uses a whitelist schema (key, type, range, enum,
   owner-only, restart-required); unknown keys are rejected.
5. **CSRF/XSS.** Cookie sessions keep the existing double-submit CSRF on all mutating requests. Backup is a
   `POST` (never a GET link) so it cannot be triggered cross-site or leaked in logs.
6. **Invite codes are unguessable and uniform.** 16 random characters (about 80 bits), looked up by key, one
   generic error for unknown/expired/revoked/used-up codes so codes cannot be probed; `/api/register` stays
   behind the strict auth rate limiter.
7. **Audit trail.** Every admin action is logged (user id, action, target - never secrets) and stored; admins
   can read the last 200 entries.
8. **Safe file writes.** Config is rewritten atomically (temp file + rename), mode 0600, validated by decoding
   it again before it replaces the old file, with the previous version kept as `config.toml.bak`.

## 3. Features

### 3.1 Registration (config-first)
```toml
[registration]
mode = "open"          # "open" | "invite_only" | "closed"

# Optional static invite codes, seeded at startup (shown read-only in the panel)
[[registration.invites]]
code = "welcome-2026"
expires_at = "2026-12-31T23:59:59Z"   # optional; omit = never
max_uses = 25                          # 0 or omitted = unlimited
```
* `open`: anyone registers. `closed`: nobody can. `invite_only`: `invite_code` required.
* Applies immediately (no restart). The panel edits the same `mode` key in the file.
* Public `GET /api/server-info` returns `{ registration_mode }` so login/register screens can hide the form or ask
  for a code. The first account on a fresh server may always register (that is how the owner is created).

### 3.2 Invitation codes
* Fields: code, note, created_by, created_at, `expires_at` (optional), `max_uses` (0 = unlimited), `uses`, `revoked`, `source` (`panel` | `config`).
* Two kinds: **limited** (`max_uses` = N) and **unlimited** (`max_uses` = 0), both with an optional expiry date.
* A use is reserved atomically before the account is created and given back if creation fails, so concurrent
  sign-ups can never exceed `max_uses`.
* Admins create (random or custom code), list (with uses/expiry/status), copy, revoke.

### 3.3 Config editing
* Panel renders a form from the server-provided schema; saving patches `config.toml` in place **keeping
  comments and order**, then hot-applies what can be applied (registration mode, upload limits, video limits,
  call participant cap) and marks the rest `restart required`.
* Editable by admins: upload/video limits, max participants, rate limits, voice mode, ports (restart).
  Owner-only: `server.domain`, `server.frontend_origin`, `server.trust_proxy_headers`, `server.dev`,
  `security.token_expire_hours`. Not editable: secrets and storage/database paths.

### 3.4 Backup (owner)
* `POST /api/admin/backup {password, passphrase}` streams a single `.cove-backup` file: BadgerDB export + uploads
  + a manifest, encrypted with AES-256-GCM using an Argon2id key from the passphrase the owner types (the master
  password is never put in the file). Restore is a CLI command (`server restore <file>`), not a panel feature.

### 3.5 Reset and delete (owner)
* **Reset** wipes users, channels, messages, files, sessions and call state but keeps the owner account, the
  owner's role, and `config.toml`. Everyone else is signed out.
* **Delete** wipes everything including the owner, removes uploads and the database directory, then shuts the
  process down. The next start is a fresh server (first registrant becomes owner), so the response warns to set
  `registration.mode` first if the server is exposed.
* Both: password + typed phrase (`RESET` / the server domain), audit entry written before the wipe.

### 3.6 Admin management (owner)
* Owner adds an admin by username, removes one, transfers ownership (password + phrase). Owner cannot be
  removed or demoted except by transfer.

## 4. API (all under `/api/admin`, all swagger-annotated with an `**Access:**` line)

| Route | Access |
|---|---|
| `GET /api/server-info` | Public |
| `GET /overview` | Admin |
| `GET /config`, `PATCH /config` | Admin (owner-only keys enforced per key) |
| `GET /invites`, `POST /invites`, `DELETE /invites/{code}` | Admin |
| `GET /audit` | Admin |
| `GET /admins`, `PUT /admins/{username}`, `DELETE /admins/{username}` | Owner |
| `POST /owner/transfer` | Owner + password + phrase |
| `POST /backup` | Owner + password |
| `POST /reset`, `POST /delete` | Owner + password + phrase |
| `/api/register` gains `invite_code` | Public |
| `/api/me` gains `server_role` | Authenticated (self only) |

## 5. Code layout
* Backend: `internal/config` (patch writer + schema), `internal/models` (`Invite`, `AuditEntry`, `User.ServerRole`),
  `internal/db` + `internal/store` (invites, audit, role queries, atomic reserve), `internal/api/admin*.go`
  (handlers) and `internal/api/runtime.go` (hot settings), `internal/backup` (archive + crypto).
* Web: `client-web/src/domains/admin/` (api, react-query hooks, tabs for Overview, Registration and invites,
  Config, Admins, Backup, Danger zone, step-up password dialog); entry is a Settings tab shown only when
  `user.server_role` is set. Desktop inherits it.
* Android: `ui/screens/admin/` using the Cove kit, same endpoints, entry in Settings for admins.
* i18n for en/fa/ar; no hard-coded strings.

## 6. Tests (written first)
* **Config:** patch keeps comments/other keys, rejects invalid values, atomic + 0600, round-trips.
* **Registration:** open/closed/invite_only matrix; first-user-becomes-owner (also under concurrency).
* **Invites:** expiry, limited vs unlimited, revoked, race (N parallel sign-ups on `max_uses=1` => exactly one), config-seeded.
* **RBAC matrix:** every admin route x {anonymous, member, admin, owner} => 401/403/200 as specified; router
  enumeration test; role not settable via `PATCH /users/me`; `server_role` hidden from other users.
* **Step-up:** wrong/missing password => 403 and no side effect.
* **Backup:** encrypted archive decrypts with the passphrase and not with a wrong one. **Reset/Delete:** data gone, owner kept (reset).
* **Web:** form-schema helpers and invite validation (Vitest). `make test`, `make front/*` stay green.

## 7. Phases
1. Config patch writer + `[registration]` + invites + `server-info` + `invite_code` on register.
2. Server roles, first-owner rule, admin middleware, overview, config API, invites API, audit, admins API.
3. Backup, reset, delete, ownership transfer (+ CLI restore).
4. Web admin domain and settings entry.
5. Android admin screen (separate session, same API).
6. Swagger regeneration, docs (`README`/`config.toml.example`), final security review.
