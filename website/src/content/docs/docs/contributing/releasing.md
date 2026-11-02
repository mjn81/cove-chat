---
title: Releasing
description: How maintainers build and publish a Cove release.
---

## Build the assets

```bash
make release
```

This builds the server for Linux, Windows and macOS (Intel and Apple silicon), builds the desktop apps, and zips everything into `release/dist/` through `scripts/package_release.sh`.

## Publish

1. Tag the commit: `git tag v0.1.0 && git push origin v0.1.0`.
2. Create a GitHub release for the tag and write the notes.
3. Upload the files from `release/dist/`:
   - `cove-server-linux-amd64.zip`, `cove-server-windows-amd64.zip`, `cove-server-darwin-*.zip`
   - `cove-desktop-mac-universal.zip`, `cove-desktop-windows-amd64.zip`, `cove-desktop-linux-amd64.zip`
   - the Android APK and a `SHA256SUMS` file
4. Push Docker images: `make docker/build-multi DOCKER_USER=<name>`.

## The website

The download page reads the latest release at build time, matching asset names by pattern, so keep the naming above. Rebuild the website after publishing (the deploy workflow does this automatically on `release: published`).

## The update manifest

Every release also feeds the auto-update system. The website build publishes `/releases/manifest.json` (the control point that servers, the desktop app and the Android app read first, with the GitHub releases API as a fallback) plus a per-version copy at `/releases/<version>.json`. The pieces:

- `website/src/lib/release-manifests.ts` fetches the ten most recent non-draft releases from the GitHub API at build time, and each release's `SHA256SUMS` asset.
- `website/src/lib/release-manifest.ts` turns a release into the manifest format. A file without a checksum in `SHA256SUMS` is left out, so always upload `SHA256SUMS` and keep the asset names above.
- `website/src/pages/releases/manifest.json.ts` serves the manifest of the highest-semver release; `[version].json.ts` serves each version.
- The `publish` job of the release workflow ends by starting the website workflow (`gh workflow run website.yml`), so the manifest is rebuilt after every release.

If GitHub cannot be reached during a site build, `manifest.json` is published as `{"error": ...}`. Clients treat that as "no manifest" and fall back to GitHub, so a failed build never blocks updates, but check the deployed file after a release: `curl https://covechat.dev/releases/manifest.json`.

The format and the update rules are described in [Server updates](/docs/administration/updates/#manifest-format). Because the first release after the updater shipped is also its first real run, treat it as a test of the updater itself: update a test server, desktop app and Android install from it before announcing it.
