---
title: Desktop app
description: Install and build the Cove desktop app for Windows, macOS and Linux.
---

The desktop app is a [Wails](https://wails.io) shell around the web client. It connects to any Cove server and supports calls and screen sharing. It authenticates with a Bearer token instead of cookies.

## Install

Download the zip for your OS from the [latest release](https://github.com/mjn81/cove-chat/releases/latest), extract it and run the app. On first launch enter your server's address (a bare domain such as `chat.example.com` is enough) or press **Use the public demo server**. See [Connect a client to a server](/docs/clients/connect/).

## Build it yourself

Prerequisites: Go, Node with pnpm, the Wails CLI, and the platform toolchain (Xcode tools on macOS, WebView2 and a C compiler on Windows, GTK3 and WebKit2GTK headers on Linux).

```bash
make front/install
make front/build
make wails/build/windows   # or wails/build/mac, wails/build/linux
```

`make wails/dev` runs the app with hot reload during development.

## Updates

The desktop app checks for new versions on its own, but it never downloads or installs anything without you.

- **Checking.** A first check runs shortly after start-up and then every 6 hours. Switch it off in **Settings > Notifications > Updates**.
- **Where it shows.** When a newer version exists, a small icon with a dot appears in the left sidebar, directly above your profile card (below the call bar while a call is on). Its popover shows the version and release notes with **Download**, then a progress bar, then **Restart to update**. **Settings > Updates** offers the same actions plus **Check now**.
- **Opt-in download.** Downloading needs a click. **Download updates automatically** is off by default; turn it on if you want the file fetched in the background. Installing always needs a click, and the app asks first if a call is running or a chat has an unsent draft.
- **Verification.** The download is hashed while it is written and compared with the SHA-256 in the release manifest (or `SHA256SUMS`). A mismatch deletes the file. The file is hashed again right before install, and a file that changed on disk is refused.
- **Install and rollback.** On restart the app swaps itself in by renaming the old copy to `*.old` (`Cove.exe`, `Cove` or `Cove.app`), starts the new one, and keeps `*.old` until the new version has stayed up for 60 seconds. If the new version crashes on start twice, the next start restores the old one.
- **Update source.** Under **Settings > Updates > Update source** you can point the app at your own manifest URL (the default is `https://covechat.dev/releases/manifest.json`, with GitHub as the fallback). See [Server updates](/docs/administration/updates/#use-your-own-mirror) for the manifest format.
- **Read-only installs.** If the app lives somewhere it cannot replace itself, the icon links to the release page instead.

:::caution
The relaunch and swap logic is new. It is covered by tests but has not been tried on every OS, including macOS with an unsigned `Cove.app`. Try the first update on a test install, and keep the manual route in mind: download the zip, check it with `sha256sum -c --ignore-missing SHA256SUMS`, replace the app, and to undo an update rename `*.old` back while the app is closed.
:::
