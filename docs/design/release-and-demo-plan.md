# Release pipeline, versioning, website sync, demo and staging

Status: **decisions approved (all recommendations).** Implementation starts after the SSH key is installed.
Domain: `covechat.dev`. Server details live in the git-ignored `.server.env`; secrets never enter the repo.

## 1. Goals

1. One action creates a release: version bump, changelog, tag, GitHub Release, every artifact attached.
2. Artifacts for **Windows, Linux, macOS and Android** (server, desktop apps, APK), plus Docker images.
3. The website shows the new version, downloads and changelog **automatically**.
4. A public **demo**, and a private-ish **staging** that follows `main`, both on the ops server.
5. **Efficient CI:** a push only runs the jobs its changed files can affect. Heavy builds run on release only.
6. Everything is labelled **Beta** until you decide otherwise.

## 2. Approved decisions

| # | Decision |
|---|---|
| 1 | release-please opens a "Release vX.Y.Z" PR; merging it tags and publishes (you already write conventional commits) |
| 2 | Docker Hub `mjn81/cove-server`, `mjn81/cove-webclient`, mirrored to GHCR |
| 3 | Start unsigned on Windows/macOS (documented on the download page); Android signed with our own keystore |
| 4 | Demo sign-up protection: Cloudflare Turnstile on web registration + server-side limits |
| 5 | Demo data: accounts auto-delete after 24 h, nightly wipe and re-seed |
| 6 | Android: GitHub APK now (AAB also built for a later Play Store release) |

### Beta policy

- All `0.x` releases are published as GitHub **pre-releases** and labelled **Beta** on the website (nav chip, hero badge, download notice, footer, docs banner). Done in the website already.
- The website reads `/releases?per_page=10` (not `/releases/latest`, which hides pre-releases), so beta builds show up.
- Docker tags per release: `x.y.z`, `x.y`, `beta`, `latest`. When we reach 1.0 we add `stable` and drop the labels.

## 3. Versioning (single source of truth)

Today the version is hard-coded in 8 places and disagrees (`0.9.0` in Go, web, Wails; `0.1.0` in Android).

- Root `VERSION` file, edited only by release-please.
- **Go:** `internal/version` package, set with `-ldflags "-X cove/backend/internal/version.Version=$VERSION"`; the three copies in `main.go`, `logger.go`, `admin.go` read it; a test pins `/api/version`.
- **Web:** `VITE_APP_VERSION` from `VERSION` at build, shown in Settings.
- **Desktop:** `wails.json` `productVersion` stamped by the release job.
- **Android:** `versionName = VERSION`, `versionCode = MAJOR*10000 + MINOR*100 + PATCH`.
- Pre-release tags like `v0.10.0-rc.1` use the same pipeline and never move `latest`.

## 4. CI that only runs what it must

### 4.1 Rules

| Rule | How |
|---|---|
| Path-aware | A `changes` job (`dorny/paths-filter`) outputs `backend`, `web`, `android`, `desktop`, `website`, `docker`. Every job has `if: needs.changes.outputs.X == 'true'` |
| Docs-only pushes run nothing | `paths-ignore: ['**.md', 'docs/**', '.github/ISSUE_TEMPLATE/**', 'LICENSE']` on CI (the website job still watches `website/**` because its docs are content) |
| Cancel stale runs | `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` for PRs and branches. **Never** cancel release or deploy runs |
| Draft PRs are cheap | heavy jobs skip when `github.event.pull_request.draft` |
| One required check | a final `ci-gate` job aggregates the others (skipped jobs count as passed) so branch protection works with path filtering |
| Heavy builds only on release | the OS matrix, signing, Docker push and desktop packaging run on a tag, never on push or PR |
| Caches everywhere | Go build + module cache, pnpm store, Gradle (`gradle/actions/setup-gradle`, build cache), Docker buildx `type=gha` layer cache, Wails/Go caches |
| Cheap on PRs | Android: `compileDebugKotlin` + unit tests only (no APK); desktop: compile check on one OS; Docker: build without push; PR artifacts are not uploaded unless the PR has a `build-artifacts` label; retention 7 days |
| Timeouts and least privilege | `timeout-minutes` on every job; `permissions:` read-only by default; third-party actions pinned to SHAs |
| Dependency noise | Dependabot/Renovate grouped weekly, so one PR per ecosystem instead of dozens |
| No pointless schedules | one weekly website rebuild (refreshes star count); the nightly soak test skips when `main` has no new commits since the last run |

### 4.2 Workflows and their triggers

| Workflow | Trigger | Runs |
|---|---|---|
| `ci.yml` | PR and push to `main`, path-filtered | `backend`: `make test` (race), `make lint`, swagger drift check. `web`: typecheck, lint, tests. `android`: compile + unit tests. `desktop`: compile check. `docker`: build check. `website`: lint, typecheck, build |
| `release-please.yml` | push to `main` (cheap, only computes the PR) | opens/updates the release PR |
| `release.yml` | tag `v*` (created by release-please) or `workflow_dispatch` (single job re-run) | build matrix (section 5), publish |
| `website.yml` | push to `main` touching `website/**`, `backend/config.toml.example`, `backend/docs/swagger.json`, `VERSION`; `release: published`; weekly | build + Pages deploy |
| `deploy-staging.yml` | push to `main` touching `backend/**`, `client-web/**`, `ops/**` | CI builds and pushes `:main` images (cached), then SSH `compose pull && up -d`. Group `staging` with cancel-in-progress so only the newest commit deploys |
| `deploy-demo.yml` | `release: published` or manual | SSH deploy of the release tag, health check, auto-rollback |
| `nightly.yml` | schedule, skipped if no new commits | stress/soak test and backup-restore drill against staging |

Pipeline diagram:

```
PR / push to main --> ci.yml (only affected parts) --> ci-gate
        |
        +--> release-please: "Release vX.Y.Z" PR --(you merge)--> tag + GitHub Release (pre-release)
                                                         |
                                                    release.yml matrix
                                                         |
                        +--------------------------------+--------------------+
                        v                                v                    v
                  website.yml                    deploy-demo.yml        assets + SHA256SUMS
        (version, downloads, changelog)         (rollback on failure)   + attestations
```

## 5. release.yml build matrix

| Job | Runner | Output |
|---|---|---|
| `server` | ubuntu | `cove-server-{linux,windows,darwin}-{amd64,arm64}` (a `CGO_ENABLED=0` build already works, so one runner cross-compiles everything) |
| `desktop-windows` | windows-latest | `Cove.exe` zip (NSIS installer later) via Wails |
| `desktop-macos` | macos-latest | universal `Cove.app` zip + `.dmg` (unsigned until signing exists) |
| `desktop-linux` | ubuntu | tar.gz (AppImage later); installs `libgtk-3-dev libwebkit2gtk-4.1-dev` |
| `android` | ubuntu + JDK 21 | signed `cove-android-<version>.apk` and `.aab` |
| `docker` | ubuntu | multi-arch (amd64, arm64) server and web client images, layer-cached |
| `publish` | ubuntu | `SHA256SUMS`, build provenance attestation, release notes, un-draft |

Independent jobs: one failing platform does not block the others; `workflow_dispatch` re-runs a single job against an existing tag. Asset names stay compatible with `website/src/lib/downloads.ts` (arm64 and AAB rows to be added).

### MacBook fallback

CI builds the Mac app, so the MacBook is optional. For signing/notarization later, or a broken Mac job: `make release/mac TAG=v0.10.0` builds the universal app locally and uploads it to the existing release with the GitHub CLI, replacing the CI asset. `make release/dry-run` builds everything the local OS can into `release/dist/` for a smoke test.

## 6. Website reflection

Done: build-time release fetch (now including pre-releases), OS-aware downloads, Beta labelling, SEO, `covechat.dev` custom domain file.

To add: `/changelog` rendered from release notes; per-asset sizes and `SHA256SUMS` link; "Try the live demo" button; docs examples pinned to the released version.
You: DNS `A` records for `covechat.dev` to `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`, `CNAME www`, then Pages -> custom domain + Enforce HTTPS.

## 7. The ops server: demo, staging and quality work

The server is not only for the demo. Uses, by value:

| Use | What | Why |
|---|---|---|
| **Demo** `demo.covechat.dev` | latest release, resets nightly | try-before-install |
| **Staging** `staging.covechat.dev` | follows `main` (invite-only, basic-auth in front) | catches real-network bugs before a release: TLS, WebSocket through a proxy, TURN/NAT, upload limits |
| **Real-network call tests** | scripted join from outside the LAN against staging | WebRTC/TURN problems never show up on localhost |
| **Nightly soak and stress** | the existing stress suite plus a long-running WebSocket/call load, results posted to the workflow summary | finds leaks and races that unit tests miss |
| **Backup-restore drill** | nightly: take an encrypted backup of staging, restore into a scratch container, verify | proves backups actually restore |
| **Status and uptime** `status.covechat.dev` | Uptime Kuma for demo, staging, website | public confidence, alerts to you |
| **Image pull cache** | CI pushes images; the server only pulls | no builds on the server |

Not recommended: a **self-hosted GitHub runner** on this machine. On a public repo, forked pull requests could run arbitrary code on it. Heavy work stays on GitHub's runners; the server only receives deploys over SSH with a key limited to a deploy user.

### 7.1 Server hardening first

1. Install the deploy public key; create a non-root `deploy` user with docker access.
2. Disable SSH password login and root login; **rotate the current password**.
3. `ufw`: SSH (restricted if possible), 80, 443, 3478/udp, 50000-50100/udp; 4000/3000 stay internal.
4. `fail2ban`, unattended security upgrades, log rotation, swap if RAM is small.
5. Read Docker/Compose versions and CPU/RAM/disk once key access works.

### 7.2 Layout

```
demo.covechat.dev / staging.covechat.dev --> Caddy (automatic HTTPS)
                                              |-- /api/*, websocket --> cove-server
                                              '-- everything else   --> cove-webclient
```

One origin per instance, so cookies and CORS just work. DNS is **DNS-only** (not proxied) so call media (UDP) reaches the server. Compose, Caddyfile, seed script and runbook live in `ops/` (no secrets); each instance keeps its own `.env` on the server. Containers get CPU/memory caps so a busy call day cannot starve the others.

### 7.3 Deploy and reset

- Demo: release publish -> SSH deploy of the tag -> health check on `/api/version` -> automatic rollback to the previous tag on failure.
- Demo nightly: stop, wipe the volume, start, run the seed script (owner account, welcome channels). Credentials only in the server's `.env`.

### 7.4 Demo spam and abuse protection (layered)

| Layer | What | Code? |
|---|---|---|
| Edge | per-IP request limits in the proxy, fail2ban on repeated 401/429, container limits, raw UDP mode off | no |
| Existing config | `rate_limit.auth_rps = 1`, lower `global_rps`, `max_file_size_mb = 5`, `max_video_size_mb = 10`, `max_video_duration_sec = 30`, `max_participants_per_call = 4`; admin kill switch flips registration to `closed` instantly | no |
| Demo mode (new, opt-in `[demo]` section, off by default) | `enabled`, `max_users`, `signups_per_ip_per_day`, `account_ttl_hours` (janitor with clean shutdown), `max_channels_per_user`, `max_messages_per_minute`, `max_storage_mb_per_user`, new accounts cannot upload files for N minutes | yes, backend, strict TDD |
| Bot gate | Turnstile token verified server-side on `POST /api/register`; web renders the widget; Android and desktop point to "create your demo account on the web" | yes, backend + web |
| Transparency | `/api/server-info` adds `demo: true`; clients show "Public demo. Data resets daily. Do not share anything private." | yes, backend + web + Android |
| Operations | uptime monitor, disk alert at 80%, audit log review, one-click user ban | no |

New routes and fields follow the repo rules (RBAC, Swagger, named DTOs, 401/403 tests, TDD).

## 8. Order of work

| Phase | What | Needs from you |
|---|---|---|
| 0 | Create GitHub repo `mjn81/cove-chat` and push; secrets; install the SSH key; DNS | section 9 |
| 1 | Single-source version, ldflags, tests | none |
| 2 | `ci.yml` (path-filtered, cached, gated) | none |
| 3 | `release.yml` + dry run on `v0.9.1-rc.1` (pre-release) | secrets |
| 4 | release-please, `/changelog`, downloads matrix updates | none |
| 5 | Server hardening, `ops/`, Caddy, staging + demo deploys | key installed |
| 6 | Demo mode backend + web banner + Turnstile | Turnstile keys |
| 7 | Nightly soak/restore drills, status page, docs (Releasing, ops runbook) | none |

Also: ignore `client-desktop/frontend/dist` and `client-desktop/build/bin` in git (generated output is currently tracked/untracked noise).

## 9. Secrets and accounts (names only)

| Where | Name | Purpose |
|---|---|---|
| GitHub Actions | `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | push images |
| GitHub Actions | `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | sign APK/AAB (I generate the keystore; **you back it up**, losing it means users cannot update) |
| GitHub Actions | `OPS_SSH_HOST`, `OPS_SSH_PORT`, `OPS_SSH_USER`, `OPS_SSH_KEY` | deploy to the server |
| Server `.env` | `COVE_MASTER_PASSWORD`, demo owner password, Turnstile secret | runtime secrets |
| Later | `APPLE_*`, Windows signing | signed desktop builds |

## 10. Risks

- Android keystore loss or leak: back up offline, never commit it.
- Unsigned desktop apps trigger OS warnings; documented on the download page.
- Wails Linux builds depend on the runner's WebKitGTK version; pinned in the workflow.
- The Docker image builds with `CGO_ENABLED=1` while release binaries use `0`; I will switch the image to `0` so both behave the same.
- Path filters can hide a break in a shared file; the nightly full run and the release build are the backstop.
