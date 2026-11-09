package com.cove.chat

import android.app.Application
import com.cove.chat.data.local.LocalData
import com.cove.chat.data.local.PreferencesManager
import com.cove.chat.data.remote.ApiClient
import com.cove.chat.data.remote.WebSocketManager
import com.cove.chat.data.model.previewText
import com.cove.chat.notify.ActiveChat
import com.cove.chat.notify.CallCoordinator
import com.cove.chat.notify.NotificationHelper
import com.cove.chat.service.BackgroundConnection
import com.cove.chat.rtc.WebRTCManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CoveApp : Application() {
    lateinit var preferencesManager: PreferencesManager
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var webSocketManager: WebSocketManager
        private set
    /**
     * The call engine every screen uses. The name is historical: it is a [CallRouter] that picks the WebRTC SFU or the
     * encrypted UDP engine per call from the server's capabilities.
     */
    lateinit var webRTCManager: com.cove.chat.rtc.CallEngine
        private set
    lateinit var notificationHelper: NotificationHelper
        private set
    lateinit var updateManager: com.cove.chat.data.update.UpdateManager
        private set
    lateinit var whisperManager: com.cove.chat.whisper.WhisperManager
        private set
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _sessionEnded = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Emits when the server ended this device's session; the navigation graph then returns to the login screen. */
    val sessionEnded: SharedFlow<Unit> = _sessionEnded.asSharedFlow()

    /** Signs out of this phone without contacting the server (lock-screen "Sign out" for a forgotten passcode). */
    fun endSessionLocally() {
        signOutLocally()
        com.cove.chat.security.AppLock.reset()
        _sessionEnded.tryEmit(Unit)
    }

    /** The local half of signing out: stop the socket, forget the session, wipe what this phone cached. */
    fun signOutLocally() {
        webSocketManager.disconnect()
        whisperManager.reset()
        preferencesManager.clearAuth()
        LocalData.wipe(this)
        BackgroundConnection.sync(this)
    }

    companion object {
        lateinit var instance: CoveApp
            private set
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) com.cove.chat.emoji.EmojiEngine.trimMemory()
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        preferencesManager = PreferencesManager(this)
        apiClient = ApiClient(preferencesManager)
        com.cove.chat.emoji.EmojiEngine.init(this, preferencesManager)
        webSocketManager = WebSocketManager(preferencesManager)
        webRTCManager = com.cove.chat.rtc.CallRouter(this, webSocketManager, preferencesManager, apiClient, WebRTCManager(this, webSocketManager))

        notificationHelper = NotificationHelper(this)
        updateManager = com.cove.chat.data.update.UpdateManager(this, preferencesManager)
        // A quiet, rate-limited look for a newer APK shortly after start; it never downloads unless the user opted in.
        appScope.launch {
            kotlinx.coroutines.delay(20_000)
            updateManager.check()
        }
        whisperManager = com.cove.chat.whisper.WhisperManager(this, webSocketManager, { preferencesManager.userId }, { preferencesManager.username })
        whisperManager.notifier = object : com.cove.chat.whisper.WhisperNotifier {
            override fun request(invite: com.cove.chat.whisper.WhisperInvite) {
                if (preferencesManager.notificationsEnabled) notificationHelper.showWhisperRequest(invite)
            }
            override fun cancelRequest(sessionId: String) = notificationHelper.cancelWhisperRequest(sessionId)
            override fun message(session: com.cove.chat.whisper.WhisperSession) {
                if (preferencesManager.notificationsEnabled) notificationHelper.showWhisperMessage(session.id, session.peerName)
            }
        }
        appScope.launch {
            webSocketManager.messageFlow.collect { m ->
                val me = preferencesManager.userId
                val watching = ActiveChat.foreground && ActiveChat.channelId == m.channelId
                if (m.senderId == me || watching) return@collect
                // The channel list gives the display name (DM partner or channel name).
                val channel = apiClient.getChannels().getOrNull()?.firstOrNull { it.id == m.channelId }
                val title = channel?.displayName(me) ?: "Cove"
                val sender = channel?.memberNames?.get(m.senderId) ?: title
                val photo = channel?.memberAvatars?.get(m.senderId)?.let { id -> kotlinx.coroutines.withTimeoutOrNull(3000) { com.cove.chat.data.remote.AvatarCache.load(id) } }
                notificationHelper.showMessage(m.channelId, title, channel?.isDirectMessage == false, sender, m.previewText(), avatar = photo)
            }
        }
        appScope.launch {
            webSocketManager.authFailedFlow.collect {
                withContext(Dispatchers.Main) { signOutLocally() }
                _sessionEnded.emit(Unit)
            }
        }
        CallCoordinator.start(this)

        // Auto-connect WebSocket if auth token exists
        if (!preferencesManager.authToken.isNullOrBlank()) {
            webSocketManager.connect()
            BackgroundConnection.sync(this)
        }
    }
}
