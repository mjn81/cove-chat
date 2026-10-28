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
