---
title: Introduction
description: What Cove is, who it is for, and how its trust model works.
---

Cove is a self-hosted chat platform for communities that want to own their data. You run one server, people connect with the web, desktop or Android client, and everything (messages, files, voice and video) stays on hardware you control.

## What you get

- Text channels, direct messages and friends, with roles and an admin panel
- Group audio and video calls plus screen sharing, built into the server
- Voice notes, file sharing and video messages
- **Whisper** chats that are end-to-end encrypted and never stored
- English, Persian and Arabic interfaces, including right-to-left layout
- A single Go binary with an embedded database, configured by one `config.toml`

## The trust model in one paragraph

Cove is **server-trusted**. Messages are encrypted in the client with AES-256-GCM and stored encrypted, but the server generates, wraps and distributes channel keys. That trade keeps multi-device sign-in and recovery simple, and it means the server operator can in principle read messages. If you do not trust whoever runs your server, use Whisper for sensitive conversations. See [Encryption model](../../security/encryption-model/).

## How the pieces fit

| Piece | What it does |
|---|---|
| Server (`cove-server`) | REST API, WebSocket hub, WebRTC SFU, TURN, encrypted BadgerDB storage |
| Web client | React single-page app, served as static files (Docker image or any web server) |
| Desktop app | Wails shell around the web client for Windows, macOS and Linux |
| Android app | Native Kotlin client |

Continue with the [Quick start](../quick-start/).
