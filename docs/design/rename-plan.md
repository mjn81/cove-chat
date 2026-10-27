# Rename plan: NodeTalk to Cove (new repo "Cove Chat")

Status: **waiting for approval.** Nothing below has been changed yet.

Premise: the new repository starts fresh, so there are no installs, sessions, Docker pulls or Whisper sessions
to keep working. Because of that this is a clean break with **no compatibility fallbacks** (old env var names,
cookies and storage keys are not read). If you want a grace period for any row, say so and I will add a fallback.

## 1. Names to decide

| Item | Proposed | Notes |
|---|---|---|
| Product name | Cove | already used in UI via `APP_NAME` |
| GitHub repo | `mjn81/cove-chat` | confirm the exact slug |
| Docker Hub images | `mjn81/cove-server`, `mjn81/cove-webclient` | confirm the account / names |
| Website base path | `/cove-chat` | GitHub Pages project path |
| Go module | `cove/backend` (desktop: `cove/desktop`) | local-style path like today; or `github.com/mjn81/cove-chat/backend` if you want it importable |
| Android applicationId / package | `com.cove.chat` | **a new app id: not an upgrade of any installed build** |
| Wails appID | `com.cove.chat.desktop` | |

## 2. Mapping

### Install-facing (users see these)

| Old | New |
|---|---|
| `nodetalk-server`, `nodetalk-server-<os>-<arch>.zip` | `cove-server`, `cove-server-<os>-<arch>.zip` |
| `nodetalk-desktop-<os>-*.zip`, `NodeTalk.exe/.app` | `cove-desktop-<os>-*.zip`, `Cove.exe/.app` |
| `nodetalk-webclient` image, buildx builder `nodetalk-builder` | `cove-webclient`, `cove-builder` |
| `NODETALK_CONFIG`, `NODETALK_MASTER_PASSWORD`, `NODETALK_BACKUP_PASSPHRASE` | `COVE_CONFIG`, `COVE_MASTER_PASSWORD`, `COVE_BACKUP_PASSPHRASE` |
| `turn_realm = "nodetalk"` (default in config) | `"cove"` |
| desktop config dir `~/.nodetalk` | `~/.cove` |
| `nodetalk_secure_prefs` (Android prefs file) | `cove_secure_prefs` |

### Runtime identifiers (clients and server change together)

| Old | New |
|---|---|
| cookies `nodetalk_session`, `nodetalk_csrf` | `cove_session`, `cove_csrf` |
| bearer / storage key `nodetalk_token`, WS subprotocol prefix `nodetalk-token.` | `cove_token`, `cove-token.` |
| WS/message tags `nodetalk-ws`, `nodetalk-msg` | `cove-ws`, `cove-msg` |
| localStorage / sessionStorage keys `nodetalk_*` (lang, record mode, player volume, handled calls, call stage height, screenshare settings ...) | `cove_*` |
| IndexedDB `NodeTalkDB`, `NodeTalkWhisperDB` | `CoveDB`, `CoveWhisperDB` |
| Android intent actions `com.nodetalk.client.*`, notification ids `nodetalk_*` | `com.cove.chat.*`, `cove_*` |

### Cryptographic context strings (the risky row)

| Old | New |
|---|---|
| `nodetalk-whisper-salt-v1` | `cove-whisper-salt-v1` |
| `nodetalk-whisper-v1-aes-...`, `nodetalk-whisper-v1-safety-number-...` | `cove-whisper-v1-...` |

These feed key derivation and safety numbers. The web client, desktop app and Android client must all change in the
same release, or a Whisper session between an old and a new client will fail to decrypt. With no existing users this
is safe; I will also add one test that pins the new derived values so they cannot drift silently.

### Code and tooling

| Area | Change |
|---|---|
| Go | module path in `go.mod` of backend and desktop; every import (`nodetalk/backend/internal/...`, ~750 lines); Swagger regenerated (`make swagger`) so `nodetalk_backend_internal_models.*` definitions and the placeholder host/terms URL are gone |
| Android | move `com/nodetalk/client` to `com/cove/chat`, update `package`/imports/manifest/namespace, `rootProject.name` |
| Desktop | `wails.json` name and appID, `app.go` strings, Go module |
| Scripts / Makefile / compose / `package_release.sh` / `.dockerignore` | file names and image names |
| Docs | README, DOCKER.md, RELEASE_GUIDE.md, desktop_build_guide.md, `.agents/rules/*` (remove the "deliberately unchanged identifiers" section), `docs/design/*`, `client-android/README.md` |
| Website | `site.ts` (repo, images), `astro.config.mjs` (base, links), all docs pages, quick-start commands |
| Existing `.env`, `config.toml`, `config.toml.bak`, `*.log` files | untracked local files; I will not edit them. `config.toml` must be updated by you if it sets the old realm |

## 3. Order of work

1. Tests first where behaviour is pinned: cookie names, WS subprotocol, env var names, Whisper derived values (backend `backend/tests/` and client unit tests).
2. Backend + Swagger, then web client, then desktop, then Android (compile with `make android/compile`).
3. Scripts, Docker, Makefile, docs, website.
4. Final sweep: `grep -ri nodetalk` must return nothing outside git history and untracked local files.
5. `make test`, `make lint`, `make front/typecheck`, `make front/lint`, `make front/test`, `make site/build`, `make android/compile`.

## 4. What I need from you

- The new repo slug, Docker Hub names and Go module style (section 1).
- Whether any row should keep a temporary fallback.
- Confirmation that breaking all existing local sessions/logins/Whisper sessions is fine.
