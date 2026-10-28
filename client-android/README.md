# Cove Android Client (`client-android`)

Native Android client for **Cove**, built with Kotlin, Jetpack Compose, Ktor, Stream WebRTC, and AES-256-GCM hardware-accelerated encryption.

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
  - Foreground Service (`CallService`) with `microphone|camera|mediaProjection` service types (the last only while sharing the screen) for uninterrupted calling on Android 14+.

---

## 🚀 How to Open and Run

### 1. Open in Android Studio
1. Launch **Android Studio**.
2. Click **Open** and select the `client-android` folder (`d:\Projects\Cove\client-android`).
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
Whisper, WebRTC group calls, profile and settings, light/dark theme, chat background patterns and English/Persian/Arabic
(Arabic is RTL). Not on mobile yet: the raw-UDP air-gapped voice mode (untested), a queued-upload list in
the composer (uploads show a spinner on the "+" button), and screen-share audio.

### Chat input and backgrounds

- **Composer** (`ui/screens/ChatInputBar.kt`): large "+" opens a bottom sheet (`AttachmentSheet.kt`) with photo/video, audio,
  file and video message; the emoji toggle lives inside the field; one trailing button is a mic when the field is empty
  (tap = hands-free recording, hold = push-to-talk, slide towards the start edge = cancel, slide up = lock) and a send
  button once there is text. 48dp targets, 24dp icons, 16sp text.
- **Chat backgrounds** (`ui/components/ChatBackground.kt`): the four web patterns (`animals`, `space`, `games`, `sweets`, ids
  shared with the web `chatBackground` setting) are converted from `client-web/src/assets/patterns/*.svg` by
  `tools/convert_patterns.py` into `app/src/main/assets/patterns/*.txt` (path data with transforms baked in). One 360x740dp tile
  is rasterised once (cached, <= 2x) and painted behind the message list as a tinted `BitmapShader`, so scrolling never
  redraws paths. Picked in Settings > Appearance, stored in `PreferencesManager.chatBackground`. Re-run the script when the
  web SVGs change.

### Calls

`rtc/WebRTCManager.kt` follows `client-web/src/rtc/WebRTCManager.ts` and `backend/internal/rtc/signaling.go` (publish + subscribe
PeerConnections, one publish offer at a time, camera/mic stream id = user id, screen stream id `screen` which the SFU forwards as
`<userId>:screen`). Added: MediaProjection screen sharing (foreground service type `mediaProjection`, started before capture;
no screen audio), camera front/back switch, deafen, `rtc/CallAudio.kt` audio routing (earpiece / speaker / Bluetooth / wired),
speaking indicator from audio levels, camera and screen quality presets with sender bitrate/fps caps, adaptive degradation on
`qualityLimitationReason`/RTT, keyframe requests on join, on screen start and when decoded frames stall, receive-quality for shared
screens (render-side only: the SFU has no simulcast), reconnect (rejoin on network change, socket reconnect or PeerConnection
failure, keeping mic/camera/screen). `CallService` shows a call-style notification with timer, Mute and Leave. `CallScreen.kt`
has grid and spotlight layouts (portrait and landscape), a full-screen shared-screen viewer with pinch-zoom, and a "More" sheet.

### Whisper

`whisper/WhisperManager.kt` implements the web flow: ECDH P-256 + HKDF + AES-GCM (`WhisperCrypto.kt`), safety number with a
verified mark, expiry modes `persistent / 5m / 1h / 24h / session_only` with per-message countdowns, burn, ended/declined
states, text, files, voice and video messages (10 MB cap; the relay frame limit is 20 MB). Nothing is stored server-side.
Non-`session_only` sessions keep the session key and wire ciphertext in `whisper/WhisperStore.kt` (per-user, `EncryptedFile`,
the Android analogue of the web IndexedDB); ended sessions stay readable until deleted. Requests also arrive as a system
notification with Accept/Decline (`notify/Notifications.kt`, works from the background through `ConnectionService`); message
notifications never contain Whisper text. Decrypted attachments are written to `cacheDir/whisper` only when opened and deleted
with their message/session.

### Icons

`res/drawable/ic_cove_mark.xml` is the bare mark (used on the server-select and login screens through `CoveMark`).
The adaptive launcher icon is the terracotta bubble on a cream background; `ic_launcher_monochrome.xml` (even-odd bubble with
the waves cut out, generated from the mark geometry) is the Android 13+ themed icon.

## Architecture Overview

```
client-android/app/src/main/java/com/cove/chat/
├── CoveApp.kt                 # Application singleton, notifications and Whisper wiring
├── MainActivity.kt            # Launcher Activity, edge-to-edge, runtime permissions
├── crypto/CryptoManager.kt    # AES-256-GCM channel encryption & zstd
├── data/                      # models, encrypted prefs, Ktor REST + WebSocket clients, avatar cache
├── notify/Notifications.kt    # Local message notifications and open-chat requests
├── whisper/                   # ECDH/HKDF/AES-GCM primitives, session manager, encrypted local store
├── rtc/                       # WebRTC SFU client, audio routing and quality presets (and the untested raw-UDP fallback)
├── service/CallService.kt     # Foreground service for calls
└── ui/                        # theme, shared components (incl. i18n), navigation, screens
```

## UI kit and naming

Kotlin symbols use the **Cove** name (`CoveTheme`, `CoveApp`, `Cove*` colours, `CoveFontFamily`); the Gradle
`applicationId` and the `com.cove.chat` package are deliberately unchanged. The manifest theme is `Theme.Cove`.

Screens are composed from one shared kit whose names and variants mirror the web client (see
`docs/design/component-cleanup-plan.md`). Do not hand-roll dialogs, buttons or rows in a screen; extend the kit instead.

| Piece | Where | Notes |
|---|---|---|
| Tokens | `ui/theme/Dimens.kt`, `Color.kt`, `Theme.kt` | `Spacing` (4-pt scale), `Radius`/`CoveShapes` (sm 4 / md 8 / lg 12), `CoveType` roles (title, body, caption, label), `Sizes`. Semantic colours via `CoveTheme.extendedColors`: `success`, `warning`, `overlay`/`onOverlay`/`mediaBackground`, plus status and mention. |
| `CoveDialog` | `ui/components/CoveDialog.kt` | Sizes `Sm / Md / Lg / Media`, title + close, body, footer actions, `alignTop` for search. `CoveConfirmDialog` for yes/no (`destructive`). |
| `CoveButton`, `CoveIconButton` | `CoveButton.kt` | Variants Default / Secondary / Outline / Ghost / Destructive, sizes Sm / Md / Lg, `loading`. Icon button: Ghost / Destructive / Filled / Scrim, `selected` toggles. |
| `CoveTextField`, `FormField`, `FieldLabel` | `CoveFields.kt` | `FormField` adds the label, the red ` *` for `required`, hint and error. |
| `CoveListRow`, `CoveBadge`, `CoveSwitchRow`, `CoveChip`, `CoveSegmented`, `CoveChoiceList`, `EmptyState`, `SectionHeader` | `CoveRows.kt` | `CoveListRow` replaces every conversation / person / result / menu / permission row. |
| `UserAvatar`, `InitialsAvatar`, `StatusDot`, `ErrorBanner`, `SectionDivider` | `Common.kt` | Unchanged shared pieces. |

Rules: user-facing strings go through `components/Text` (translated by `I18n.kt`); use theme colours
(`MaterialTheme.colorScheme.primary/error`, `CoveTheme.extendedColors`) instead of `Color(0x..)`; only Whisper mode uses
its own `CoveWhisper*` palette, passed to the kit via the `container` / `border` / `containerColor` overrides.
