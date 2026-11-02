---
title: Server updates
description: Update a Cove server from the admin panel, get notified about new releases, update offline, and roll back.
---

The web client has no installer of its own: it is served by your server, so updating the server updates the web client too. **Admin > Overview > Server update** is the one place to do it.

Updates follow one rule everywhere in Cove: **Cove checks quietly and tells you, but never downloads or installs anything until you ask.**

:::caution
The restart and install steps are new. They are covered by unit tests but have not been exercised end to end on every platform (the real restart on Linux, macOS and Windows in particular). Try the first update on a test install, and take a [backup](/docs/self-hosting/backups-restore/) before updating a server you care about.
:::

## Online update

1. Open **Admin > Overview > Server update**. It shows the running version, the latest version, the release notes and where the information came from. Use **Check now** to bypass the 10-minute cache (this is recorded in the audit log).
2. Only the **owner** can install. Press **Update server** and confirm. Admins can see the status but the button is owner-only.
3. The server downloads the release for its own platform, verifies its SHA-256 checksum, unpacks the binary next to the running one and swaps them. The previous binary is kept as `<binary>.old`.
4. The server restarts: it disconnects clients, closes the database and frees its ports first. On Linux and macOS it re-executes in place (same process ID, so systemd or your shell keeps supervising it); on Windows it starts a detached new process. Clients reconnect on their own.
5. If the new binary cannot start, the server restores `.old` and starts that instead.

Every step is in the audit log (`server.update.start`, `server.update.installed`, `server.update.failed`).

The update is refused when the server is already on the latest version, when a release has no checksum for your platform, or when the checksum does not match. Nothing is replaced in those cases.

### Where the version comes from

Cove checks, in order:

1. **The release manifest**, `https://covechat.dev/releases/manifest.json` by default.
2. **The GitHub releases API** (`mjn81/cove-chat`), if the manifest cannot be reached or is invalid.

The highest version newer than the running one wins. Pre-releases are offered while the server itself runs a 0.x or pre-release build, because every 0.x release is published as a pre-release. A release is only considered once it carries the file for your platform and its checksum. If your running version is older than the release's `min_version`, the panel tells you to install an intermediate release first.

### Where the button does not work

The panel reports an install `mode` and disables the button when the server cannot update itself:

| Mode | Cause | What to do |
|---|---|---|
| `docker` | Running in a container (detected via `/.dockerenv`, container markers in the cgroup, or `COVE_IN_DOCKER=1`) | Update the image, see [Docker](#docker) |
| `unknown` | `go run`, a read-only install directory, or a platform without a release build | Replace the binary by hand, see [Upgrading](/docs/self-hosting/upgrading/) |

## Notices to admins

Once the server is running, a background check runs every 12 hours (the first one 2 minutes after start). When a new version exists, the **owner and admins** (nobody else) get one direct message from the Cove account with the version, short notes, and a link that opens **Settings > Admin**. Each version is announced once.

Turn it off with `notify_admins = false` under `[update]` (also available in Admin > Settings > Updates).

## Docker

A containerized server never updates itself. Pull the new image and recreate the container:

```bash
docker compose pull && docker compose up -d
```

Pin a release tag in your compose file rather than `latest` if you want to choose when to move. Tools such as Watchtower work too. See [Docker and Compose](/docs/self-hosting/docker/).

## Updating without internet (air-gapped)

For a non-Docker install that cannot reach GitHub or covechat.dev:

1. On a computer with internet, download `cove-server-<os>-<arch>.zip` for the server's platform from the [release page](https://github.com/mjn81/cove-chat/releases), and the `SHA256SUMS` file.
2. In **Admin > Overview > Server update**, open **Manual update (no internet)**.
3. Choose the file, type the **version** (for example `0.10.0`) and paste the checksum: either the 64-character SHA-256 for that file, or the whole `SHA256SUMS` content.
4. Upload. The file is streamed to a private temporary directory (never held in memory, limited to 256 MiB) and checked: the zip must hold exactly one entry, the binary for this operating system and architecture; the checksum must match when you gave one; and the version must be newer than the running one. Nothing from the file is executed during these checks.
5. Press **Install uploaded version**. It uses the same swap, `.old` copy and restart as an online update.

Limits to be aware of: the version comes from what you type, because the file carries no version that can be verified without running it, so a wrong version only mislabels the install. Without a checksum the file is trusted as uploaded, and the panel says so. Always paste the checksum.

## Use your own mirror

You can host the manifest yourself, so servers inside a closed network still get online checks and notices.

```toml
[update]
manifest_url = "https://updates.example.internal/releases/manifest.json"
github_fallback = false   # do not try GitHub when the mirror is down
notify_admins = true
```

`manifest_url` and `github_fallback` are owner-only settings, and changing them needs a restart. They can also be edited in **Admin > Settings > Updates**.

### Manifest format

Serve a JSON document over **HTTPS** at that URL:

```json
{
  "channel": "beta",
  "version": "0.10.0",
  "released_at": "2026-11-02T10:00:00Z",
  "notes": "Markdown release notes",
  "release_url": "https://github.com/mjn81/cove-chat/releases/tag/v0.10.0",
  "min_version": "0.9.0",
  "assets": {
    "server-linux-amd64": { "url": "https://updates.example.internal/files/cove-server-linux-amd64.zip", "sha256": "<64 hex characters>", "size": 31457280 },
    "server-windows-amd64": { "url": "https://updates.example.internal/files/cove-server-windows-amd64.zip", "sha256": "<64 hex characters>", "size": 31457280 }
  }
}
```

- `channel` is `stable` or `beta`; anything other than `stable` counts as a pre-release.
- `min_version` is optional: the lowest running version allowed to upgrade straight to this one.
- Server platform keys are `server-<os>-<arch>`: `server-linux-amd64`, `server-linux-arm64`, `server-darwin-amd64`, `server-darwin-arm64` and `server-windows-amd64`. Desktop keys are `windows-amd64`, `linux-amd64` and `darwin-universal`, and `android` is the APK. Only list the platforms you mirror.
- Every asset needs an HTTPS `url` and a mandatory `sha256`. A manifest with a missing or malformed checksum, a non-HTTPS URL or an invalid version is rejected as a whole (and, unless `github_fallback = false`, Cove then falls back to GitHub).
- The asset files can live anywhere reachable; the official manifest points at GitHub release downloads.

The easiest way to produce one is to copy the official `https://covechat.dev/releases/manifest.json` (a per-version copy exists at `/releases/<version>.json`), download the files you want, and rewrite the `url` values. Keep the `sha256` values: they must match the files you host.

## Security model

- Downloads must use HTTPS.
- Every file is checked against a SHA-256 from the manifest or `SHA256SUMS` before anything is replaced. A missing or different checksum aborts the update.
- Downloads and extraction are size limited, and archives are extracted with protection against path traversal and symlink escapes.
- The checksums come from the same place as the files. They protect against corruption and partial uploads, **not** against someone who can publish to the release repository or the domain. Signing the manifest with a key whose public half ships inside the apps is planned but not done.
- An update is only ever applied by an explicit click by the owner.

## Rolling back

- **Binary install:** stop the server, rename `<binary>.old` back to the binary name, start it. Do not run an older server against data a newer version has already migrated; restore the [backup](/docs/self-hosting/backups-restore/) taken before updating if the schema changed.
- **Docker:** set the previous image tag and run `docker compose up -d`.
- The server also rolls back by itself if the new binary fails to start after the swap.

## Related

- Desktop and Android apps check for updates on their own, with the same opt-in rules: [Desktop app](/docs/clients/desktop/#updates), [Android app](/docs/clients/android/#updates).
- Server config keys: [config.toml reference](/docs/configuration/reference/).
- Admin endpoints: `GET /api/admin/update`, `POST /api/admin/update`, `POST /api/admin/update/upload` in the [REST API reference](/docs/api/rest/).
