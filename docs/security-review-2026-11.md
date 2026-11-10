# Security review, November 2026

Review of Cove before the first stable release, on top of v0.11.2 (`next` at `974aa07`). Focus: **data and access**.

No secret values appear in this document; it only refers to locations.

## Summary

| Severity | Found | Fixed | Open or accepted |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 9 | 6 | 3 |
| Low | 11 | 4 | 7 |
| Info | 5 | 1 | 4 |

No finding allows an unauthenticated attacker to read or change data. The access model held up: every route is either public on purpose or answers 401 to an anonymous caller, channel-scoped routes answer the same 404 for a channel you are not in as for one that does not exist, and every mutation made with the cookie needs the CSRF header. The two High findings were an account-deletion bug that kept the account usable, and untrusted input reaching ffmpeg.

**The Bot API (new auth tier, endpoints, gateway) was being built in parallel and is not covered.** It needs its own review once merged: token format and hashing, scopes, per-bot channel membership checks, rate limits, and the gateway's origin/frame limits.

## Scope and method

In scope: `backend/` (REST, WebSocket hub, RTC signalling, WebRTC SFU and embedded TURN, UDP media router, update fetcher, storage, config), `client-web/` (including the theme and pack loaders), `client-desktop/` (Wails bridge), `client-android/`, `docker-compose.yml`, `ops/`, `.github/workflows`, dependencies.

Method:

1. Read the code against the rules in `.agents/rules/` and `docs/api-standard.md`.
2. Walked every route in `NewRouter` and every WebSocket event, checking tier, object-level checks and existence leaks.
3. Static and dependency checks: `govulncheck` (backend), `pnpm audit --prod` (client-web, website), `gofmt`/`go vet`, grep of logger calls, history grep for committed key material.
4. Wrote failing tests for each confirmed problem (`backend/tests/security_review_test.go`, `turn_peer_test.go`), then fixed it in a small separate commit (`fix(security): ...`). All fixes are additive; no wire contract changed (two new error codes in the existing envelope: `auth.errors.username_invalid`, `auth.errors.too_many_attempts`, `apiErrors.username_invalid`, `apiErrors.profile_text_too_long`, translated in en/fa/ar).
5. Added `backend/tests/access_matrix_test.go`, which reads the route table from `handler.go` so a new route that forgets `protect(...)` fails the build.

Not done: dynamic testing of the Android app on a device, fuzzing of the UDP media parser (it was read, see below), a scan of the Android dependencies (no offline scanner), anything on the production or demo servers.

## Findings

Status: **fixed** (commit on this branch), **open**, **accepted** (with reason).

| ID | Sev | Where | Impact | Status |
|---|---|---|---|---|
| SR-01 | High | `api/users.go` DeleteAccount | Deleting an account removed only the calling token. Every other device of the "deleted" account kept a valid session and a live socket and could keep posting and creating channels. | **fixed** (all sessions and sockets revoked) |
| SR-02 | High | `api/files.go` upload, `transcodeVideo` | `is_video` came from the client, so any signed-in user could send a text HLS/concat playlist that ffmpeg opened, reading other local files or fetching URLs (SSRF) and returning the result as the transcoded file. Exploit depth depends on the ffmpeg build. | **fixed** (only bytes that sniff as `video/*` reach ffmpeg; `-protocol_whitelist file`) |
| SR-03 | Medium | `ws/hub.go`, `api/auth.go` Logout | Sign-out, expiry and account removal left the WebSocket open, so a signed-out device kept receiving live events. | **fixed** (hub closes sockets of an ended session; heartbeat checks the session) |
| SR-04 | Medium | `rtc/turn.go` | pion/turn admits every peer when no permission handler is set: a call participant could send relayed UDP to the host's loopback services or a cloud metadata address. | **fixed** (`AllowTURNPeer`: loopback, unspecified, link-local, multicast refused; LAN peers stay allowed) |
| SR-05 | Medium | `cmd/server/main.go`, `go.mod` | No header read deadline (slowloris). Go toolchain 1.26.2 and `golang.org/x/net` 0.50 carried 29 reachable advisories (HTTP/2 DoS, TLS, net/url), plus `klauspost/compress`. CI took Go 1.25.5 from `go.mod`. | **fixed** (10 s header deadline, 64 KiB header cap, `toolchain go1.26.10`, x/net 0.60, compress 1.20.2) |
| SR-06 | Medium | `client-web` deps | `pnpm audit --prod` reported 40 advisories (20 high) in axios 1.15 and react-router 7.14. Most concern Node-only code paths; the router ones (open redirect in `<Link>`, DoS) apply to the browser. | **fixed** (axios 1.21.1, react-router-dom 7.18.2; audit clean). `axios@1.21.1` is allow-listed in `pnpm-workspace.yaml` because it is newer than the minimum release age. |
| SR-07 | Medium | `api/auth.go` Login | Only a per-IP limit protected sign-in; a distributed guess at one account was not slowed. | **fixed** (20 wrong passwords per name per 15 min answers 429 before hashing; unknown names tracked the same way) |
| SR-08 | Medium | `ws/handlers.go` | A chat message or edit could carry up to 20 MB of ciphertext (the frame limit), so any member could fill the database. | **fixed** (1 MiB ciphertext, 64 byte nonce) |
| SR-09 | Low | `api/auth.go`, `users.go`, `store` | Usernames had no character rules and no cap (blank names, right-to-left overrides, zero-width characters, 1 MB names) and "Alice" could be registered next to "alice". | **fixed** (3-64 characters, no control/format/space edge characters, case-insensitive uniqueness for new names; existing accounts untouched) |
| SR-10 | Low | `api/users.go` | `custom_msg` and `banner_color` unbounded, and broadcast to everyone with the presence event. | **fixed** (190 and 32 characters) |
| SR-11 | Low | `api/files.go`, `storage` | A multipart upload buffered up to the whole size limit in RAM; blobs were written 0644 in a 0755 directory. | **fixed** (8 MB in RAM, 0600 / 0700) |
| SR-12 | Low | `client-web/nginx.conf`, `docker-compose.yml` | The web image sent no `nosniff`, framing, referrer or permissions headers (the page CSP is a build-time meta tag and cannot carry `frame-ancestors`). Compose did not forbid privilege gain. | **fixed** |
| OP-01 | Medium | `client-android` `network_security_config.xml` | Cleartext HTTP and **user-installed CAs** are trusted for every domain, so an attacker on the network who tricked the user into installing a CA, or any plain `http://` server, exposes the session token and all traffic. | **open**, product decision. Proposal below. |
| OP-02 | Medium | `backend/Dockerfile` | The server container runs as root. Compromise of the process (for example through ffmpeg) is root in the container, and the config (master password) and data are root-owned. | **open**. Needs a tested entrypoint that fixes ownership of the mounted volume and drops to an unprivileged user; not changed blind because existing bind-mounted data and the single-file `config.toml` mount would stop working. |
| OP-03 | Medium | `pkg/update`, desktop `SetUpdateSettings`, `ops` | Server and desktop self-update verify a SHA256SUMS file served next to the binary over HTTPS: integrity, not authenticity. Whoever controls the manifest origin (or, for the desktop, anything that can call `SetUpdateSettings`, which accepts any manifest URL) can ship a binary. The server owner-only manifest URL setting is the only gate. Android is protected by APK signature checks. | **open**. Sign releases (ed25519 or minisign, public key compiled in) and verify before replacing; make the desktop manifest URL not settable from the webview. |
| OP-04 | Low | `config/config.go` | The generated master password is stored in plain text in `config.toml` next to the data it protects (file mode 0600), and printed once at first start. The KEK uses a fixed Argon2 salt, which is fine for a random master password and weak for a chosen one. | **accepted**: documented model. Recommend `COVE_MASTER_PASSWORD` from a secret store in production and an operator-chosen passphrase of 20+ characters. |
| OP-05 | Low | `go.mod` | `govulncheck` still reports GO-2026-4479 (`pion/dtls/v2` 2.2.7, random-nonce AES-GCM), pulled in by `pion/turn/v3` via `pion/stun`. No fix exists in v2. The embedded TURN relay speaks UDP and TCP only, not DTLS, and WebRTC itself uses dtls v3. | **open, low**. Migrate `rtc/turn.go` to `pion/turn/v5` (already an indirect dependency). |
| OP-06 | Low | `middleware/middleware.go` realIP | With `trust_proxy_headers` on, the first `X-Forwarded-For` hop is used, which a client can set when the proxy appends instead of overwriting. `CF-Connecting-IP` and `X-Real-IP` win first, so behind Cloudflare/nginx-proxy-manager with those set this is not reachable. | **accepted**, documented in the config comment; revisit with the proxy topology. |
| OP-07 | Low | `config/schema.go` | A non-owner admin may edit `rate_limit.*` and `voice.*` (restart required), which lets a malicious admin weaken limits. | **open**. Make those keys `OwnerOnly`. |
| OP-08 | Low | `auth/auth.go` | No cap on live sessions per user (sign-in is rate limited, so growth is slow). | **open**. Evict the oldest above ~50. |
| OP-09 | Low | `client-desktop/files.go` | The webview can call `SaveFile` (any file name, sanitized, into `Downloads/Cove`), `RevealFile`, `SetUpdateSettings`, `InstallUpdateAndRestart`. Only the embedded build runs in the webview, so these are reachable only through an XSS in `client-web` (none found: no `dangerouslySetInnerHTML`, no markdown renderer, links limited to `http(s)`/`mailto`). | **accepted**, with OP-03 for the update calls. |
| OP-10 | Low | `.github/workflows`, `client-android/app/build.gradle.kts` | Actions are pinned by tag, not commit SHA. The Android release build falls back to the debug keystore when the signing secrets are missing, and R8 is off. | **open**. Pin by SHA (Dependabot, added here, keeps them current); fail the release job when the keystore is missing. |
| OP-11 | Info | design | No channel-key rotation when a member is removed: the removed member keeps the keys they already received (cannot fetch new ciphertext or files, server enforces that). Whisper public keys are relayed by the server without authentication, so a malicious server could man-in-the-middle a Whisper. Both follow from "server-trusted" and are documented. | **accepted** |
| OP-12 | Info | `docs`, `ops` | Android dependencies (Ktor 3.0.1, OkHttp, WebRTC 1.3.10, security-crypto) were not machine-scanned. | **open**: run OSV-scanner in CI; Dependabot added. |
| OP-13 | Info | `api/users.go` GetUser | Any signed-in user can read another user's `status_preference` (for example `dnd`). | **accepted** |
| OP-14 | Info | `backend/internal/federation` | Federation router exists but is not mounted; no exposure today. | **accepted**; review before enabling. |
| OP-15 | Info | repo history | `client-web/.env` and `frontend/.env` were committed once. They held only local API/WebSocket URLs, no secrets. Keys and tokens grep: none found in the working tree or history. | **fixed** earlier |

Counts: High 2 (both fixed), Medium 9 (SR-03..SR-08 fixed; OP-01..03 open), Low 11 (SR-09..SR-12 fixed; OP-04..OP-10 open or accepted), Info 5.

## What was checked and held

- **AuthZ/IDOR.** `protect`, `protectMember`, `protectAdmin`, `protectOwner` wrap every route. Admin role is read from the database on every request. Channel roles are checked in handlers (`>= RoleAdmin`/`RoleOwner`); kicking needs a strictly higher role than the target; role changes are owner-only and limited to member/admin. Files are served only to active members of the owning channel (including public channels), and uploads into a channel need active membership. Pack, sticker and custom-emoji objects check ownership. Invite codes are logged only as digests.
- **Auth.** Argon2id (t=2, 64 MiB, 4 lanes, 16-byte salt, constant-time compare); unknown users burn the same Argon2 cost. Session tokens are 256-bit random, stored only as SHA-256, with expiry, per-device revocation and revocation on password change. Cookies are `HttpOnly` (session), `Secure` outside dev, `SameSite=Lax`; CSRF is double-submit on every cookie-authenticated mutation (matrix test). Tokens are never read from the URL. CORS only reflects configured origins with credentials; the wildcard never carries credentials. WebSocket origin is checked in production.
- **Crypto and data at rest.** Channel keys are random 256-bit, wrapped by the KEK; the DEK is wrapped by the KEK; AES-GCM nonces are 96-bit random per message; the database is encrypted. Backups are passphrase-encrypted. Whisper state is RAM only (pending sessions capped, TTL'd, cleaned on disconnect). Logging of secrets: none found (`logger.*` calls reference IDs; invite codes are hashed).
- **Input handling.** JSON bodies are capped at 1 MiB; uploads are capped and content-sniffed against an allowlist (SVG excluded) and served as `attachment` with `nosniff`; storage paths are server-generated UUIDs (no traversal). Stickers and emoji are decoded and size/dimension limited (no SVG). Updates require HTTPS, a matching checksum, a strictly newer version and a fixed zip entry name. The UDP media parser bounds fragment count and pending frames and drops malformed packets (read, not fuzzed). The captcha is a stateless proof-of-work.
- **Clients.** Web: no HTML injection sinks, URL tokenizer only emits `http(s)`/`mailto`, theme files are parsed with zip-bomb, entry-count and image limits and only PNG/JPEG/WebP; a production CSP is set. Desktop: session token and cache key live in the OS keystore, not on disk. Android: tokens in `EncryptedSharedPreferences`, `allowBackup=false`, the only exported components are the launcher activity and the boot receiver (which checks its action), no deep links, no WebView, FileProvider limited to four cache folders, updates HTTPS-only with SHA-256 check.

## Access matrix

`—` means no check beyond the tier. "Member" = active member of the channel `{id}` (otherwise 404, the same as a missing channel).

| Tier | Routes |
|---|---|
| **Public** | `GET /api/version`, `GET /api/server-info`, `POST /api/register`, `POST /api/login` (per-IP and per-account throttle), `GET /api/captcha/challenge` (global IP limit) |
| **Authenticated** (session + CSRF on cookie mutations) | `POST /api/logout`, `GET /api/me`, `GET /api/sessions`, `POST /api/sessions/terminate-others`, `DELETE /api/sessions/{id}` (own sessions only), `DELETE`/`PATCH /api/users/me`, `GET /api/users`, `GET /api/users/{id}`, `GET /api/users/{id}/presence`, relationships (`GET /api/relationships`, `/incoming`, `GET`/`PUT /api/users/{id}/relationship`; privacy settings checked in the store), `POST`/`GET /api/channels`, `GET /api/channels/explore` (public channels only, no invite link), `GET`/`POST /api/join/{link}` (DMs and private channels by id answer 404; kicked users refused), emoji and builtin sticker assets, `GET/POST /api/packs`, `GET/PATCH/DELETE /api/packs/{id}`, install/uninstall, items and order (owner of the pack only, admin for server packs), `POST /api/files` (channel uploads: Member), `GET /api/files/{id}` (channel files: Member) |
| **Channel Member** (`protectMember`) | `GET /api/channels/{id}`, `GET .../members`, `GET .../messages` |
| **Channel Admin** (`protectMember` + role) | `PATCH /api/channels/{id}`, `POST .../invite/regenerate`, `POST .../members`, `DELETE .../members/{uid}` (kick: target role must be lower; leaving yourself needs only Member) |
| **Channel Owner** | `DELETE /api/channels/{id}` (groups; a DM member may delete for themselves), `PATCH .../members/{uid}` (role change) |
| **Server Admin** (`protectAdmin`, role re-read per request) | `GET /api/admin/overview`, `/config`, `PATCH /api/admin/config` (owner-only keys enforced), invites (`GET`/`POST`/`DELETE`), `/audit`, `GET /api/admin/admins`, `GET /api/admin/update`, packs and custom emoji management, unknown `/api/admin/*` paths |
| **Server Owner** (`protectOwner`; dangerous ones also need the password, with a lockout) | `POST /api/admin/notices`, `PUT`/`DELETE /api/admin/admins/{username}`, `POST /api/admin/owner/transfer`, `/backup`, `/restore`, `/reset`, `/delete`, `POST /api/admin/update`, `/update/upload`, `/restart` |

WebSocket events (after an authenticated, origin-checked upgrade, 30 events/s per connection):

| Event | Check |
|---|---|
| `message`, `message_edit`, `message_delete`, `read_receipt` | active member of `channel_id`; edit/delete only the sender's own message of that channel; DM privacy and block rules; invite and sticker messages validated; 1 MiB ciphertext cap |
| `whisper_init/accept/reject/msg/close` | friends only; only the two participants; accept only by the target; pending sessions capped; nothing persisted |
| `call_*` | calling enabled; the RTC manager re-checks channel membership (`rtc_signal_membership_test.go`) |
| unknown types | ignored |

The tests that enforce this: `access_matrix_test.go` (anonymous 401 on every non-public route, CSRF on every cookie mutation, outsider 404 on every channel route), `admin_rbac_test.go` (role matrix for admin routes), `security_test.go`, `ws_security_test.go`, `rtc_signal_membership_test.go`.

## Proposed Android network security config (OP-01)

Release builds should trust only system CAs and refuse cleartext, with a debug overlay for development. Self-hosters on a plain-HTTP LAN or with their own CA need an in-app choice instead of a global allowance, which is the product decision to make.

`app/src/main/res/xml/network_security_config.xml` (release):

```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>
</network-security-config>
```

`app/src/debug/res/xml/network_security_config.xml` (debug only, referenced through a `debug` manifest overlay):

```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors><certificates src="system" /><certificates src="user" /></trust-anchors>
    </base-config>
</network-security-config>
```

Then, for users who must reach `http://192.168.x.x` or a private CA: warn on the server-select screen when the URL is `http://`, and either pin a user-chosen server certificate fingerprint in the app (OkHttp `CertificatePinner`/custom trust manager scoped to that host) or keep a settings switch that is off by default. Android cannot express "private IP ranges only" in XML, so the choice has to live in code.

## Residual risks and recommendations before the first stable release

1. **Sign the releases** (OP-03) and make the desktop update source non-configurable from the webview. This is the largest remaining supply-chain exposure.
2. **Decide the Android network policy** (OP-01) and ship the release config above.
3. **Run the server container unprivileged** (OP-02) with a tested entrypoint; keep `no-new-privileges` (added).
4. **Review the Bot API** when merged (new token tier, scopes, gateway).
5. Make `rate_limit.*` and `voice.*` owner-only (OP-07), cap sessions per user (OP-08), migrate to `pion/turn` v5 (OP-05).
6. Keep Dependabot (added) and add `govulncheck`, `pnpm audit` and an OSV scan of the Android lockfile to CI.
7. Fuzz `pkg/udpmedia` header and fragment parsing (`go test -fuzz`) before enabling `raw_udp` on untrusted networks.
8. Operators: set `COVE_MASTER_PASSWORD` from a secret store, put the server behind TLS (cookies are `Secure` outside dev), and set `trust_proxy_headers` only behind a proxy that overwrites the forwarding headers.

## Verification

Run on this branch: `go test ./... -short` (all packages pass, including the new tests), `go vet ./...`, `govulncheck ./...` (one open advisory, OP-05), `pnpm audit --prod` (client-web, website: none), client-web `typecheck`, `lint`, `test` (1020 passing). The long `TestStressBackend` was not run (about ten minutes of Argon2 on this machine).
