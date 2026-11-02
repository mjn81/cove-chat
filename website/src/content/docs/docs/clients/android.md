---
title: Android app
description: Install the native Cove Android client and connect it to your server.
---

The Android client is native (Kotlin and Jetpack Compose). It supports messaging, voice notes, group calls, Whisper, and swipe-to-reply and forward.

## Install

Download the APK from the [latest release](https://github.com/mjn81/cove-chat/releases/latest) and allow installation from your browser or file manager when Android asks.

## Connect

On first launch, enter your server address on the server selection screen, then sign in or register. A bare domain such as `chat.example.com` is enough: the app tries `https` first. To look around first, type `demo.covechat.dev`. See [Connect a client to a server](/docs/clients/connect/) for the details and troubleshooting.

## Build it yourself

```bash
make android/compile     # fast Kotlin compile check
make android/build       # debug APK
make android/install     # install on a connected device or emulator
```

## Updates

Builds installed from GitHub or a downloaded APK can update themselves. Builds from an app store are updated by the store instead.

- **Checking.** After start-up the app checks for a newer APK at most once a day, using the release manifest and falling back to GitHub. The check does not send your Cove session.
- **Where it shows.** A badged **Update available** entry at the top of Settings, and a one-time dismissible card in the chat list. It never opens a dialog and never blocks anything.
- **Download.** In **Settings > App updates** read the notes and tap **Download**. **Download updates automatically** is off by default; when on, it only downloads on unmetered Wi-Fi.
- **Verification.** The APK is checked against the SHA-256 from the manifest after downloading and again just before the installer opens. A mismatch deletes the file.
- **Install.** Tap **Install update**. Android needs permission to install apps from Cove ("install unknown apps"); if it is not yet allowed, Cove opens that settings screen first. Android then shows its own confirmation, so an update is never installed silently.

:::caution
The Android install flow is new and has only been checked with unit tests, not yet on a range of devices. Try it on a test install first. You can always install the APK from the [releases page](https://github.com/mjn81/cove-chat/releases/latest) by hand.
:::
