---
title: Android app
description: Install the native Cove Android client and connect it to your server.
---

The Android client is native (Kotlin and Jetpack Compose). It supports messaging, voice notes, group calls, Whisper, and swipe-to-reply and forward.

## Install

Download the APK from the [latest release](https://github.com/mjn81/cove-chat/releases/latest) and allow installation from your browser or file manager when Android asks.

## Connect

On first launch, enter your server address (for example `https://chat.example.com`) on the server selection screen, then sign in or register.

## Build it yourself

```bash
make android/compile     # fast Kotlin compile check
make android/build       # debug APK
make android/install     # install on a connected device or emulator
```
