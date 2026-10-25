# NodeTalk Android Client (`client-android`)

Native Android client for **NodeTalk**, built with Kotlin, Jetpack Compose, Ktor, Stream WebRTC, and AES-256-GCM hardware-accelerated encryption.

---

## 🛠 Tech Stack

- **UI & Framework**: 100% Kotlin + Jetpack Compose (Material 3)
- **Calling Engine**:
  - **Default**: WebRTC SFU via `io.getstream:stream-webrtc-android` (Dual PeerConnection: Publish & Subscribe) matching `backend/internal/rtc/` and `client-web/src/rtc/WebRTCManager.ts`.
  - **Air-Gapped Fallback**: Raw UDP packet streaming on port `9090` matching `backend/internal/voice/router.go`.
- **Networking**:
  - **REST API**: Ktor HTTP Client (`OkHttp` engine) with Kotlinx Serialization.
  - **Real-Time Duplex**: Ktor WebSocket Client (`/ws?token=...`).
- **Security & Cryptography**:
  - **Client-Side Encryption**: `AES/GCM/NoPadding` (256-bit key, 12-byte IV) using Android `javax.crypto.Cipher`.
  - **Compression**: Zstandard (`com.github.luben:zstd-jni` Level 10).
  - **Tokens & Secrets**: Android `EncryptedSharedPreferences` backed by `MasterKey` in Android KeyStore.
- **Background Lifecycle**:
  - Foreground Service (`CallService`) with `microphone|camera` service types for uninterrupted calling on Android 14+.

---

## 🚀 How to Open and Run

### 1. Open in Android Studio
1. Launch **Android Studio**.
2. Click **Open** and select the `client-android` folder (`d:\Projects\NodeTalk\client-android`).
3. Android Studio will automatically sync the Gradle project using the included Gradle 8.11.1 distribution.

### 2. Connect to Local Backend
- If running on the **Android Emulator**:
  - The default URL is set to `http://10.0.2.2:4000` (which automatically routes to your host machine's `localhost:4000`).
- If running on a **Physical Device (USB Debugging / Wi-Fi)**:
  - Enter your local machine's LAN IP, for example: `http://192.168.1.50:4000`.

---

## Build notes

- Use the Makefile from the repo root: `make android/compile`, `make android/build`, `make android/install`. It runs the checked-in `gradlew` on a JDK 17-23 it finds in `~/.jdks` / Program Files (override with `ANDROID_JDK=...`), because Gradle 8.11 and Kotlin 2.0 cannot start on JDK 24+ (Android Studio 2025 bundles JDK 25). In Android Studio set Settings > Build > Gradle > Gradle JDK to a 17-23 JDK.
- AGP 8.13 / Gradle 8.14 / Kotlin 2.0.21. Native libs (`stream-webrtc-android` 1.3.10, `zstd-jni` 1.5.7-6) are 16 KB page-size aligned for 64-bit ABIs, as Google Play requires; check a new build with `zipalign -c -P 16 4 app-debug.apk` or by inspecting the `.so` LOAD segments. Do not bump `zstd-jni` past 1.5.7-6 without raising `compileSdk` (newer releases need API 37).
- The emulator reaches the host machine at `10.0.2.2`; the server-select step rewrites `localhost` to that automatically.
- `zstd-jni` must be the `@aar` artifact; the plain JVM jar has no Android native libs.
- `design-reference/` holds the web-client screenshots and tokens the UI is matched against.

## Features

Server select, login/register, conversations (DMs and channels), live encrypted chat with replies, edits and deletes,
photos/files, voice and video messages, friends, channel management, explore/join, read receipts and local notifications,
Whisper (zero-persistence E2EE), WebRTC group calls (audio + camera), profile and settings, light/dark theme and
English/Persian/Arabic (Arabic is RTL). Not on mobile yet: screen sharing, the raw-UDP air-gapped voice mode (untested),
and file attachments inside Whispers.

## Architecture Overview

```
client-android/app/src/main/java/com/nodetalk/client/
├── NodeTalkApp.kt             # Application singleton, notifications and Whisper wiring
├── MainActivity.kt            # Launcher Activity, edge-to-edge, runtime permissions
├── crypto/CryptoManager.kt    # AES-256-GCM channel encryption & zstd
├── data/                      # models, encrypted prefs, Ktor REST + WebSocket clients, avatar cache
├── notify/Notifications.kt    # Local message notifications and open-chat requests
├── whisper/                   # ECDH/HKDF/AES-GCM primitives and the in-memory session manager
├── rtc/                       # WebRTC SFU client (and the untested raw-UDP fallback)
├── service/CallService.kt     # Foreground service for calls
└── ui/                        # theme, shared components (incl. i18n), navigation, screens
```
