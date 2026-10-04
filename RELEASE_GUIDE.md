# NodeTalk Release Guide

This guide explains how to perform a proper multi-platform release for NodeTalk on GitHub, covering the desktop clients (Windows, macOS, Linux) and the backend server.

## 1. Prerequisites
Before starting a release, ensure you have the following installed:
- **Go** (1.21+)
- **Node.js** (18+) & **pnpm** (`corepack enable`)
- **Wails CLI** (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
- **Docker** (optional, for Docker images)

> [!NOTE]
> Building for all platforms from a single machine is possible with Wails, but building the Linux binary on macOS/Windows requires a Docker-based cross-compiler or a separate Linux environment.

## 2. Automated Build & Package
The easiest way to prepare all assets is using the provided `Makefile` target. This will build all clients, all backend binaries, and package them into `.zip` files.

```bash
# This will build everything and output zips to release/dist/
make release
```

### What this does:
1.  **Backend**: Builds `nodetalk-server` for Linux, Windows, and macOS (Intel & Silicon).
2.  **Desktop**: Builds the Wails app for macOS (Universal), Windows (amd64), and Linux (amd64).
3.  **Packaging**: Runs `scripts/package_release.sh` to zip these binaries for easy distribution.

## 3. GitHub Release Steps

### Step A: Push a New Tag
Tag your commit with a version number (e.g., `v0.1.0`).

```bash
git tag v0.1.0
git push origin v0.1.0
```

### Step B: Create Release on GitHub
1.  Go to your repository on GitHub.
2.  Click on **Releases** -> **Draft a new release**.
3.  Select the tag you just pushed (`v0.1.0`).
4.  Enter a release title (e.g., `NodeTalk v0.1.0 Beta`).
5.  Write your release notes (describe new features and fixes).

### Step C: Upload Assets
Upload the following files from `release/dist/`:
- `nodetalk-desktop-mac-universal.zip`
- `nodetalk-desktop-windows-amd64.zip`
- `nodetalk-desktop-linux-amd64.zip`
- `nodetalk-server-linux-amd64.zip`
- `nodetalk-server-windows-amd64.zip`
- `nodetalk-server-darwin-universal.zip` (optional, for self-hosters on Mac)

> [!TIP]
> GitHub automatically generates "Source code (zip)" and "Source code (tar.gz)" from your tag, so you don't need to upload those manually.

### Step D: Publish
Click **Publish release**.

## 4. Docker Images (Optional)
If you want to provide Docker images as part of the release:

```bash
# Tag and push to Docker Hub
make docker/push DOCKER_USER=yourusername
```

## 5. Summary of Build Artifacts
| Artifact | Platform | Location |
| :--- | :--- | :--- |
| **macOS App** | macOS (Intel/M1/M2) | `release/dist/nodetalk-desktop-mac-universal.zip` |
| **Windows App** | Windows 10/11 | `release/dist/nodetalk-desktop-windows-amd64.zip` |
| **Linux App** | Ubuntu/Debian/etc | `release/dist/nodetalk-desktop-linux-amd64.zip` |
| **Server Binary** | Linux (for VPS) | `release/dist/nodetalk-server-linux-amd64.zip` |
| **Server Binary** | Windows (Self-host) | `release/dist/nodetalk-server-windows-amd64.zip` |
