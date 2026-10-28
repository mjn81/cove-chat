# Release pipeline, versioning, website sync and the public demo

Status: **plan, waiting for approval.** Nothing in here has been built yet.
Domain: `covechat.dev` (website). Demo: `demo.covechat.dev` on the ops server (details in the git-ignored `.server.env`).

## 1. Goals

1. One action creates a release: version bump, changelog, tag, GitHub Release, and every artifact attached.
2. Artifacts for **Windows, Linux, macOS and Android** (server, desktop apps, APK), plus Docker images.
3. The website shows the new version, downloads and changelog **automatically**, with no manual edit.
4. A public **demo instance** that updates itself on each release, resets on a schedule, and cannot be spammed.
5. The MacBook is optional: the pipeline builds macOS too. The MacBook is only a fallback (section 5).

## 2. Decisions I need from you

| # | Question | My recommendation |
|---|---|---|
| 1 | Release trigger | **release-please**: it opens a "Release vX.Y.Z" pull request (version bump + changelog from your `feat:`/`fix:` commits). Merging it tags and publishes. You already write conventional commits. Alternative: `make release VERSION=x.y.z` by hand. |
| 2 | Registries | Docker Hub `mjn81/cove-server`, `mjn81/cove-webclient` (already referenced everywhere) **and** GHCR as a mirror. |
| 3 | Code signing | Start **unsigned**. Windows shows a SmartScreen warning and macOS needs right-click Open until signed. Signing needs an Apple Developer ID ($99/yr) and a Windows certificate or SignPath (free for OSS). Android is signed with our own keystore from day one. |
| 4 | Demo sign-up protection | Cloudflare **Turnstile** (free, privacy-friendly) on web registration plus the server-side limits below. Alternative: self-hosted ALTCHA proof-of-work, no third party. |
| 5 | Demo data policy | Accounts and content auto-delete after 24 hours; full wipe and re-seed nightly. |
| 6 | Android store | GitHub APK only for now; Play Store later (the pipeline also builds the AAB). |

## 3. Versioning (single source of truth)

Today the version is hard-coded in 8 places and they disagree (`0.9.0` in Go, web, Wails; `0.1.0` in Android).

- A root `VERSION` file (managed by release-please) is the only place a human or bot edits.
- **Go:** new `internal/version` package; `-ldflags "-X cove/backend/internal/version.Version=$VERSION"` at build. The three copies in `main.go`, `logger.go` and `admin.go` read it. A test pins that `/api/version` returns it.
- **Web client:** `VITE_APP_VERSION` set from `VERSION` at build and shown in Settings and the sidebar header.
- **Desktop:** `wails.json` `productVersion` stamped by the release job.
- **Android:** `versionName = VERSION`, `versionCode = MAJOR*10000 + MINOR*100 + PATCH` (always increasing).
- **Website:** reads the latest GitHub release at build time (already implemented) and gets a `/changelog` page generated from release notes.
- Pre-releases use tags like `v0.10.0-rc.1`: same pipeline, marked "pre-release", never tagged `latest`.

## 4. Workflows

```
push to main --> ci.yml (tests, lint, typecheck, build all)
                    |
        release-please opens/updates "Release v0.10.0" PR
                    |  you merge it
                    v
          tag v0.10.0 + GitHub Release (draft)
                    |
        release.yml  (matrix, below)  -- uploads assets + SHA256SUMS, publishes the release
                    |
     +--------------+------------------+
     v                                 v
 website.yml (rebuild site:        deploy-demo.yml (SSH to server,
 version, downloads, changelog)     pull new image, health check, rollback on failure)
```

### release.yml jobs

| Job | Runner | Output |
|---|---|---|
| `server` | ubuntu | `cove-server-{linux,windows,darwin}-{amd64,arm64}` zips / tar.gz. A `CGO_ENABLED=0` build already works, so one runner cross-compiles every target |
| `desktop-windows` | windows-latest | `Cove.exe` zip (NSIS installer later) via Wails |
| `desktop-macos` | macos-latest | universal `Cove.app` zip and `.dmg` via Wails (unsigned until signing is set up) |
| `desktop-linux` | ubuntu | tar.gz (AppImage later); installs `libgtk-3-dev libwebkit2gtk-4.1-dev` |
| `android` | ubuntu + JDK 21 | signed `cove-android-<version>.apk` and `.aab` from `:app:assembleRelease` / `bundleRelease` |
| `docker` | ubuntu | multi-arch (amd64, arm64) images for server and web client, tags `x.y.z`, `x.y`, `latest` (not on pre-releases) |
| `publish` | ubuntu | `SHA256SUMS`, build provenance attestation (`actions/attest-build-provenance`, free for public repos), release notes, un-drafts the release |

Asset names stay compatible with the download page matcher (`cove-server-windows-amd64`, `cove-desktop-mac...`, `.apk`); I will add arm64 and the AAB rows to `website/src/lib/downloads.ts`.

All jobs are independent: one failing platform does not block the others, and `workflow_dispatch` can re-run a single job against an existing tag.

## 5. Making it easy for you (including the MacBook)

- **Normal path: nothing on your machine.** GitHub's macOS runner builds the Mac app.
- **MacBook fallback** (for signing/notarization later, or if the Mac job breaks): `make release/mac TAG=v0.10.0` builds the universal app locally and uploads it to the existing release with the GitHub CLI. One command, same file names, replaces the CI asset.
- `make release/dry-run` builds every artifact the local OS can build into `release/dist/` for a smoke test before tagging.
- A release candidate (`v0.9.1-rc.1`) is the first run, so mistakes never touch `latest`.

## 6. Website reflection

Already in place: build-time fetch of the latest release, OS-aware download buttons, rebuild on `release: published`, custom domain `covechat.dev` (`public/CNAME`).

To add:
- `/changelog` page rendered from release notes (all languages show the English notes).
- Version badge in the hero and footer (exists) plus per-asset sizes and the `SHA256SUMS` link.
- "Try the live demo" button in hero, nav and the download page.
- Docs snippets use the released version tag instead of `latest`.
- GitHub Pages setup (you): DNS `A` records for `covechat.dev` to `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`, a `CNAME` for `www`, then enable Pages + "Enforce HTTPS" in the repo settings.

## 7. Demo instance

### 7.1 Server first (before anything is deployed)

The credentials currently live in a plain-text file and the account is password-based. Before hosting anything public:

1. Install the deploy public key (given in chat) and create a non-root `deploy` user with docker access.
2. Disable SSH password login and root login; keep key-only access. **Rotate the current password.**
3. Firewall (`ufw`): allow SSH (ideally restricted), 80, 443, 3478/udp, 50000-50100/udp. Nothing else is public (4000 and 3000 stay internal).
4. `fail2ban`, unattended security upgrades, log rotation, a swap file if RAM is small.
5. Confirm Docker and Compose versions, CPU/RAM/disk (I will read these over SSH once key access works).

### 7.2 Layout

```
demo.covechat.dev  -->  Caddy (automatic HTTPS)
                         |-- /api/*, websocket --> cove-server (internal)
                         '-- everything else    --> cove-webclient (internal)
```

One origin means session cookies and CORS just work (`frontend_origin = https://demo.covechat.dev`). DNS record `demo` -> server IP, **DNS-only** (not proxied), so call media (UDP) reaches the server directly. Compose file, Caddyfile and a runbook live in `ops/demo/` in the repo (no secrets; the server keeps its own `.env`).

### 7.3 Deploy and reset

- `deploy-demo.yml` runs on release publish: SSH with the deploy key (GitHub secret) -> pull images for the new version -> `up -d` -> health check on `/api/version` -> automatic rollback to the previous tag if it fails.
- Nightly job: stop, wipe the data volume, start, run the seed script (owner account, a few welcome channels). Credentials for the demo owner are only in the server's `.env`.

### 7.4 Spam and abuse protection (layered)

| Layer | What | Needs code? |
|---|---|---|
| Edge | Caddy/nginx per-IP request limits, fail2ban on repeated 401/429, container CPU/RAM limits, no raw UDP mode | no |
| Existing config | `rate_limit.auth_rps = 1`, lower `global_rps`, `max_file_size_mb = 5`, `max_video_size_mb = 10`, `max_video_duration_sec = 30`, `max_participants_per_call = 4`; admin panel can flip registration to `closed` instantly (kill switch) | no |
| Demo mode (new, opt-in `[demo]` section; defaults off, normal servers unaffected) | `enabled`; `max_users` (hard cap); `signups_per_ip_per_day`; `account_ttl_hours` (janitor deletes accounts, messages and files; owned goroutine with clean shutdown); `max_channels_per_user`; `max_messages_per_minute`; `max_storage_mb_per_user`; new accounts cannot upload files for the first N minutes | yes, backend, strict TDD |
| Bot gate | Turnstile (or ALTCHA) token verified server-side on `POST /api/register`. Web renders the widget. Android and desktop show "create your demo account on the web" because their register screens cannot run the widget | yes, backend + web |
| Transparency | `/api/server-info` gains `demo: true`; clients show a banner "Public demo. Data resets daily. Do not share anything private." | yes, backend + web + Android |
| Operations | uptime monitor, disk alert at 80%, admin audit log reviewed, easy user ban | no |

Every new route or field follows the repo rules (RBAC, Swagger, named DTOs, tests for 401/403, TDD).

## 8. Order of work

| Phase | What | Needs from you |
|---|---|---|
| 0 | Create the GitHub repo `mjn81/cove-chat`, push; add Docker Hub token and secrets; install the deploy public key on the server; DNS records | the items listed in section 9 |
| 1 | Single-source version + ldflags + tests | none |
| 2 | `ci.yml` and `release.yml`; dry run on `v0.9.1-rc.1` | secrets from phase 0 |
| 3 | release-please, changelog page, website download matrix updates | none |
| 4 | Server hardening, `ops/demo`, Caddy, `deploy-demo.yml` | key installed |
| 5 | Demo mode backend + web banner + Turnstile | Turnstile keys |
| 6 | Docs (Releasing page, ops runbook), monitoring, final end-to-end test | none |

## 9. Secrets and accounts (names only, values never in the repo)

| Where | Name | Purpose |
|---|---|---|
| GitHub Actions | `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | push images |
| GitHub Actions | `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | sign the APK/AAB (I generate the keystore; **you must back it up**, losing it means users cannot update) |
| GitHub Actions | `DEMO_SSH_HOST`, `DEMO_SSH_PORT`, `DEMO_SSH_USER`, `DEMO_SSH_KEY` | deploy to the demo server |
| Server `.env` | `COVE_MASTER_PASSWORD`, demo owner password, Turnstile secret | runtime secrets |
| Optional later | `APPLE_*`, Windows signing | signed desktop builds |

## 10. Risks

- Android keystore loss or leak: back up offline; never commit it.
- Unsigned desktop apps trigger OS warnings; documented on the download page until signing exists.
- The demo server is a shared host: containers get CPU and memory caps so a call-heavy day cannot starve other services.
- Wails Linux builds depend on the WebKitGTK version of the runner image; pinned in the workflow.
- The Docker image currently builds with `CGO_ENABLED=1`; the release binaries use `0`. I will switch the image to `0` as well so both behave identically.
