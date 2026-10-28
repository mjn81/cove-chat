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
