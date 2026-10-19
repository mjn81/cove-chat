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

## 📁 Architecture Overview

```
client-android/app/src/main/java/com/nodetalk/client/
├── NodeTalkApp.kt             # Application singleton & dependency initialization
├── MainActivity.kt            # Launcher Activity & runtime permissions
├── crypto/
│   └── CryptoManager.kt       # AES-256-GCM encryption & Zstandard compression
├── data/
│   ├── model/Models.kt        # DTOs matching Go backend & WebSocket protocols
│   ├── local/
│   │   └── PreferencesManager # Encrypted storage for token, user ID & server URL
│   └── remote/
│       ├── ApiClient.kt       # Ktor REST client (/api/login, /api/channels, etc.)
│       └── WebSocketManager.kt# Duplex WebSocket manager (/ws)
├── rtc/
│   ├── WebRTCManager.kt       # WebRTC SFU manager (publish & subscribe connections)
│   └── RawUdpVoiceManager.kt  # Air-gapped UDP audio fallback (port 9090)
├── service/
│   └── CallService.kt         # Foreground Service for persistent audio/video calls
└── ui/
    ├── navigation/NavGraph.kt # Compose navigation routes
    ├── screens/
    │   ├── ServerSelectScreen # Server URL configuration & ping
    │   ├── LoginScreen.kt     # Authentication & registration
    │   ├── ChannelListScreen  # Channel list & creation
    │   ├── ChatScreen.kt      # Encrypted real-time chat stream
    │   └── CallScreen.kt      # WebRTC group calling stage
    └── theme/                 # NodeTalk dark theme color palette
```
