# Auto-update

Cove can update itself in two places: the **desktop app** (Telegram-style background updates) and the **server**
(a button in the admin panel). Both use the same library, `backend/pkg/update` (Go module `cove/update`), and the
assets attached to each GitHub release by `.github/workflows/release.yml`.

## What a release contains

| Asset | Used by |
|---|---|
| `cove-server-{linux,darwin}-{amd64,arm64}.zip`, `cove-server-windows-amd64.zip` | server update (one binary inside, named like the zip) |
| `cove-desktop-windows-amd64.zip` (`Cove.exe`), `cove-desktop-linux-amd64.zip` (`Cove`), `cove-desktop-mac-universal.zip` (`Cove.app`) | desktop update |
| `SHA256SUMS` | integrity check for every download |

## How versions are chosen

* The updater reads the **releases list** (`GET /repos/mjn81/cove-chat/releases`), not `/releases/latest`: that
  endpoint ignores pre-releases and every 0.x Cove release is published as one.
* It picks the **highest semver** that is newer than the running version, never a downgrade or the same version.
* Pre-releases (the GitHub flag or a `-rc.1` tag) are offered when the running build is itself 0.x or a pre-release,
  or when the user switched "Include pre-releases" on. A user who switches it off keeps it off.
* A release is only considered if it already carries the platform zip **and** `SHA256SUMS`, so a release that is
  still uploading is skipped until it is complete.

## Desktop

1. A first check runs ~30 s after start-up, then every 6 hours (toggle: Settings > Notifications > Updates >
   "Check for updates automatically"; "Check now" always works).
2. A newer release is downloaded to `<app data>/updates/<version>/`, hashed while downloading and compared with
   `SHA256SUMS`. A mismatch deletes the file and nothing is staged. A staged update survives restarting the app.
3. The web UI shows a small **"Update ready: Restart"** card at the bottom corner of the window (and a button in
   Settings). It never restarts by itself. If a call is running or any chat has an unsent draft, clicking Restart
   first asks for confirmation.
4. On Restart the zip is hashed again (a file changed on disk since verification is refused), extracted next to the
   installed app and swapped in by renaming: the current `Cove.exe` / `Cove` / `Cove.app` becomes `*.old`, the new
   one takes its name. Windows cannot overwrite a running exe but can rename it, which is why renaming is used.
5. The new copy is started with `--relaunch-after=<pid>`; it waits for the old process to exit before taking the
   single-instance lock. On macOS the relaunch goes through `open -n`.
6. **Rollback.** A marker file records the update. The new version must stay up for 60 s to be confirmed (then the
   marker and the `*.old` copy are deleted). If it dies on start twice, the third start restores the `*.old` copy
   and relaunches it. If the relaunch itself fails, the previous version is restored immediately.
7. Installs in a read-only location (for example `C:\Program Files` without admin rights, `/usr/bin`) cannot swap
   themselves: the card then links to the release page for a manual download.

Config keys in the desktop `config.json`: `auto_update` (default on) and `update_prerelease` (default on while the
app is 0.x, off for stable builds).

The desktop app learns its real version from `-ldflags "-X main.buildVersion=<VERSION>"` (set by the release
workflow and the `wails/build*` Makefile targets); without it, it falls back to `productVersion` in `wails.json`.

## Server

Admin panel > Overview > **Server update** (admins see the status, only the owner sees the button).

* `GET /api/admin/update` reports current and latest version, release notes, the install `mode` and progress.
  Release lookups are cached for 10 minutes (GitHub allows 60 unauthenticated calls per hour per IP);
  `?refresh=1` ("Check now") bypasses the cache and is audited.
* `POST /api/admin/update` (owner only) returns `202` and runs the job: download, verify `SHA256SUMS`, extract the
  binary next to the running one, rename-swap (old kept as `<binary>.old`), then restart. Progress is polled from
  `GET`. Every step is written to the audit log (`server.update.start`, `.installed`, `.failed`).
* **Restart.** The server shuts down gracefully (WebSocket clients disconnected, database closed, ports freed) and
  then re-executes itself: `exec` on Linux/macOS (same PID, so systemd or a shell keeps supervising it) and a
  detached child process on Windows. If the new binary cannot start, the `.old` copy is restored and started.
* **Docker is never self-updated.** The container is detected (`/.dockerenv`, container markers in
  `/proc/1/cgroup`, or `COVE_IN_DOCKER=1`); the endpoint answers `mode: "docker"`, refuses `POST` with `409` and
  the panel shows:

  ```
  docker compose pull && docker compose up -d
  ```

  Containers can also be kept current automatically with [Watchtower](https://containrrr.dev/watchtower/).
* Installs that cannot be replaced (`go run`, read-only directory, no release build for the platform, e.g.
  Windows/arm64) report `mode: "unknown"` and must be updated by hand.

## Security model

* Downloads use **HTTPS to GitHub** only (plain `http://` is refused except in tests).
* Every artifact is checked against the release's **`SHA256SUMS`**; a missing file, a missing entry or a different
  digest aborts before anything is replaced. Downloads and extraction are size-limited, and archives are extracted
  with zip-slip and symlink-escape protection.
* The checksum file is served by the same GitHub release as the binary, so it protects against corruption and
  partial uploads, **not** against someone who can publish to the repository (or break TLS to GitHub).
  Hardening step for the future: sign a release manifest (for example minisign/ed25519) with an offline key whose
  public half is compiled into the server and desktop app, and verify it before trusting `SHA256SUMS`. Release
  provenance attestations (`actions/attest-build-provenance`) are already produced and can be checked by hand.
* Updates are only ever applied by an explicit user action (desktop button, server owner button).

## Manual fallbacks

* **Desktop:** download the zip for your platform from the GitHub release, verify it with
  `sha256sum -c --ignore-missing SHA256SUMS`, and replace the app yourself. To undo an automatic update, rename
  `Cove.exe.old` (or `Cove.old`, `Cove.app.old`) back to the original name while the app is closed.
* **Server (binary):** download `cove-server-<os>-<arch>.zip`, verify the checksum, stop the server, replace the
  binary, start it. To roll back, stop it and rename `<binary>.old` back.
* **Server (Docker):** `docker compose pull && docker compose up -d`.
* **Disable the desktop checks:** Settings > Notifications > Updates, or `"auto_update": false` in `config.json`.

## Not verified yet

The swap-and-relaunch paths are covered by unit tests with temp directories and injected relaunch hooks, but the
real process restarts (server `exec` on Linux/macOS and the detached child on Windows, the desktop relaunch on each
OS including macOS `open -n`, an unsigned `Cove.app` being replaced while Gatekeeper is active) have not been run
for real on any OS. Treat the first real-world release as a test of the updater itself, and keep the manual
fallbacks above in mind.
