# Auto-update

Cove updates in four places, all built on the same rules: **check quietly, tell the user, never download or install
without being asked** (downloads can be switched to automatic; installs never can).

| Client | Check | Download | Install |
|---|---|---|---|
| Desktop app | background, every 6 h | click on the update icon (or opt-in automatic) | click "Restart" |
| Android app | background, once a day | tap "Download" (or opt-in automatic, Wi-Fi only) | tap "Install" then confirm in Android |
| Server | background (admin notice) / "Check now" | owner clicks "Update server" | same click, then it restarts |
| Web client | none | none | it is updated with the server it is served from |

The shared Go library is `backend/pkg/update` (module `cove/update`); Android has a Kotlin port of the same rules
(`client-android/.../data/update`).

## Update source and the manifest

Order of sources, for every client:

1. **The release manifest**, default `https://covechat.dev/releases/manifest.json` (the website build publishes it).
2. **The GitHub releases API** (`mjn81/cove-chat`) when the manifest is unreachable or invalid.

The server and the desktop app can point at their own manifest URL (mirrors, air-gapped networks). On the server it is
`[update] manifest_url` in `config.toml` (also editable by the owner in Admin > Settings > Updates) and
`github_fallback = false` stops it from trying GitHub; on the desktop it is Settings > Updates > Update source.

### Manifest format

```json
{
  "channel": "beta",
  "version": "0.10.0",
  "released_at": "2026-11-02T10:00:00Z",
  "notes": "Markdown release notes",
  "release_url": "https://github.com/mjn81/cove-chat/releases/tag/v0.10.0",
  "min_version": "0.9.0",
  "assets": {
    "server-linux-amd64":  { "url": "https://github.com/.../cove-server-linux-amd64.zip", "sha256": "<64 hex>", "size": 31457280 },
    "server-linux-arm64":  { "...": "..." },
    "server-windows-amd64": { "...": "..." },
    "server-darwin-arm64": { "...": "..." },
    "windows-amd64":       { "url": "...cove-desktop-windows-amd64.zip", "sha256": "...", "size": 0 },
    "linux-amd64":         { "url": "...cove-desktop-linux-amd64.zip", "sha256": "...", "size": 0 },
    "darwin-universal":    { "url": "...cove-desktop-mac-universal.zip", "sha256": "...", "size": 0 },
    "android":             { "url": "...cove-android-0.10.0.apk", "sha256": "...", "size": 0 }
  }
}
```

* `channel` is `stable` or `beta`; anything but `stable` is a pre-release.
* `min_version` (optional) is the lowest running version allowed to upgrade directly; older installs are told to
  install an intermediate release first.
* Asset `url` must be HTTPS and can point anywhere (the website points at GitHub release downloads); `sha256` is
  mandatory and is what every client verifies. A manifest with a missing or malformed checksum, a non-HTTPS URL or a
  bad version is rejected as a whole, and the client falls back to GitHub.
* Platform keys: `server-<os>-<arch>` (linux/darwin amd64+arm64, windows amd64), desktop `windows-amd64`,
  `linux-amd64`, `darwin-universal`, and `android`.

**How it is published.** `website/src/pages/releases/manifest.json.ts` builds it at site-build time from the GitHub
releases and each release's `SHA256SUMS` (files without a checksum are left out), plus a per-version copy at
`/releases/<version>.json`. The release workflow's `publish` job already ends by starting the website workflow, so
the manifest follows every release. If GitHub is unreachable during the site build, the endpoint publishes
`{"error": ...}`, which clients treat as "no manifest" and fall back.

## How versions are chosen

* The **highest semver** newer than the running version wins; never a downgrade or the same version.
* The releases list is read, not `/releases/latest` (it ignores pre-releases and every 0.x release is one).
* Pre-releases are offered when the running build is 0.x or itself a pre-release, or when the user opted in. A user
  who switches it off keeps it off.
* A release is only considered when it already carries the platform file and a checksum.

## Opt-in rules

* **Checking** is automatic and cheap (one small request).
* **Downloading** needs a click. The setting "Download updates automatically" is **off by default** on desktop and
  Android (Android additionally requires unmetered Wi-Fi).
* **Installing** always needs a click; Android also shows its own system confirmation. Nothing ever restarts by
  itself, and on desktop a restart asks first while a call is running or any chat has an unsent draft.

## Desktop

1. A first check runs ~30 s after start-up, then every 6 hours. Toggle: Settings > Notifications > Updates.
2. A newer version shows a small **icon with a dot** in the left sidebar, in its own row directly above the profile
   card (below the call bar when one is showing, so they stack without overlapping). Its popover shows the version
   and notes with **Download** -> progress -> **Restart to update**. Settings > Updates has the same actions plus
   "Check now".
3. Download goes to `<app data>/updates/<version>/`, is hashed while downloading and compared with the manifest
   (or `SHA256SUMS`); a mismatch deletes the file. A staged update survives restarting the app.
4. On Restart the zip is hashed again (a file changed on disk since verification is refused), extracted next to the
   app and swapped in by renaming: `Cove.exe` / `Cove` / `Cove.app` becomes `*.old`. (Windows cannot overwrite a
   running exe but can rename it.)
5. The new copy is started with `--relaunch-after=<pid>` and waits for the old process to exit before taking the
   single-instance lock; macOS goes through `open -n`.
6. **Rollback.** The new version must stay up 60 s to be confirmed (then the `*.old` copy is deleted). If it dies
   on start twice, the third start restores `*.old` and relaunches it. If the relaunch itself fails, the previous
   version is restored immediately.
7. Read-only install locations cannot swap themselves; the icon then links to the release page.

Config (`config.json`): `auto_update` (default on), `update_prerelease` (default on while 0.x), `auto_download`
(default off), `update_manifest_url` (default the domain). The app learns its real version from
`-ldflags "-X main.buildVersion=<VERSION>"`, falling back to `wails.json`.

## Android

Sideloaded / GitHub builds only (`BuildConfig.SELF_UPDATE`; a Play-store flavour sets it to `false`).

1. After start-up the app checks the manifest (GitHub fallback) at most once a day, with a client that never sends
   the Cove session token.
2. A newer APK shows a **badged "Update available" entry at the top of Settings** and a **one-time dismissible
   card** in the chat list. It is never a dialog and never blocks anything.
3. Settings > App updates: notes, **Download** with progress, then **Install update**. The APK is downloaded to
   `cache/updates/`, its SHA-256 is verified against the manifest (a mismatch deletes it) and checked again right
   before the installer opens.
4. Install uses a `FileProvider` URI with `ACTION_VIEW` (`application/vnd.android.package-archive`). It needs
   `REQUEST_INSTALL_PACKAGES`; if "install unknown apps" is not yet allowed for Cove, the app opens that settings
   screen first. Android always shows its own confirmation, so there is no silent install.
5. "Download updates automatically" (off by default) downloads on unmetered Wi-Fi only.

## Server and the web client

The web client has no installer: it is updated with the server it is served from, so **Admin > Overview > Server
update** is the single place.

* `GET /api/admin/update` reports current and latest version, notes, the source used (manifest or GitHub), the
  install `mode` and progress. Lookups are cached for 10 minutes; `?refresh=1` bypasses the cache and is audited.
* `POST /api/admin/update` (owner) returns `202` and runs the job: download, verify checksum, extract the binary next
  to the running one, rename-swap (old kept as `<binary>.old`), restart. Audit: `server.update.start`, `.installed`,
  `.failed`.
* **Restart.** Graceful shutdown (clients disconnected, database closed, ports freed), then `exec` on Linux/macOS
  (same PID, so systemd or a shell keeps supervising it) or a detached child on Windows. If the new binary cannot
  start, `.old` is restored and started.
* **Docker is never self-updated.** Detected via `/.dockerenv`, container markers in `/proc/1/cgroup` or
  `COVE_IN_DOCKER=1`; the endpoint answers `mode: "docker"` and refuses `POST`/upload with `409`. Run
  `docker compose pull && docker compose up -d` (or let Watchtower do it).
* `go run`, read-only directories and platforms without a release build report `mode: "unknown"`.

### Admin notices

A background checker (every 12 h, first run 2 min after start, stopped during graceful shutdown) messages **only the
owner and admins** from the Cove account when a new version exists: version, short notes and a link
`<frontend_origin>/?settings=admin` that opens Settings > Admin. Each version is announced once; the last announced
version is stored in the database. Setting: `[update] notify_admins` (default on).

### Manual / air-gapped update

For non-Docker installs that cannot reach GitHub or the website:

1. On a computer with internet, download `cove-server-<os>-<arch>.zip` for the server's platform from the release
   page (and `SHA256SUMS`).
2. Admin > Overview > Server update > **Manual update**: choose the file, type the **version** (for example
   `0.10.0`) and paste the checksum (a 64-hex SHA-256 or the whole `SHA256SUMS`). Upload.
3. `POST /api/admin/update/upload` (owner, multipart) streams the file to a private temp directory (never held in
   memory, capped at 256 MiB), then checks: the zip holds exactly one entry, the binary for this OS/architecture
   (or, for a plain binary, the ELF/PE/Mach-O header matches); the checksum matches when given; the version is
   newer than the running one. Nothing from the file is executed.
4. Press **Install uploaded version**: same swap, `.old` rollback copy and restart as an online update
   (`POST /api/admin/update` with `{"source":"upload"}`).

Limits: the version comes from the form (the file carries no verifiable version without running it), so a wrong
version only mislabels the install; without a checksum the file is trusted as uploaded and the UI says so. Point
`[update] manifest_url` at an internal mirror and set `github_fallback = false` to make online checks work inside
an air-gapped network too.

## Security model

* HTTPS only for downloads (plain `http://` is refused except in tests).
* Every artifact is verified against a **SHA-256** from the manifest or `SHA256SUMS`; a missing or different digest
  aborts before anything is replaced. Downloads and extraction are size-limited and archives are extracted with
  zip-slip and symlink-escape protection.
* The checksums come from the same place as the files (the website, or the GitHub release), so they protect against
  corruption and partial uploads, **not** against someone who can publish to the repository or the domain. Hardening
  for later: sign the manifest (for example ed25519/minisign with an offline key whose public half ships inside the
  apps) and verify it before trusting any checksum. Build provenance attestations are already produced.
* Updates are only ever applied by an explicit user action.

## Manual fallbacks

* **Desktop:** download the zip, verify with `sha256sum -c --ignore-missing SHA256SUMS`, replace the app. To undo
  an automatic update rename `*.old` back while the app is closed.
* **Server (binary):** replace the binary and restart; roll back by renaming `<binary>.old`.
* **Server (Docker):** `docker compose pull && docker compose up -d`.
* **Android:** install the APK from the GitHub release.

## Not verified yet

Unit tests cover the logic with temp directories and injected hooks, but the real process restarts (server `exec` on
Linux/macOS, the Windows detached child, the desktop relaunch on each OS including macOS `open -n`), replacing an
unsigned `Cove.app` under Gatekeeper, the Android installer intent on a device, and publishing the manifest from CI
(the site build was run locally against the real releases) have not been exercised end to end. Treat the first
release after this ships as a test of the updater itself and keep the manual fallbacks in mind.
