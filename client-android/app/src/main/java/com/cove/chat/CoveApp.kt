package com.cove.chat

import android.app.Application
import com.cove.chat.data.local.PreferencesManager
import com.cove.chat.data.remote.ApiClient
import com.cove.chat.data.remote.WebSocketManager
import com.cove.chat.rtc.RawUdpVoiceManager
import com.cove.chat.data.model.previewText
import com.cove.chat.notify.ActiveChat
import com.cove.chat.notify.CallCoordinator
import com.cove.chat.notify.NotificationHelper
import com.cove.chat.service.BackgroundConnection
import com.cove.chat.rtc.WebRTCManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CoveApp : Application() {
    lateinit var preferencesManager: PreferencesManager
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var webSocketManager: WebSocketManager
        private set
    lateinit var webRTCManager: WebRTCManager
        private set
    lateinit var rawUdpVoiceManager: RawUdpVoiceManager
        private set
    lateinit var notificationHelper: NotificationHelper
        private set
    lateinit var whisperManager: com.cove.chat.whisper.WhisperManager
        private set
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    companion object {
        lateinit var instance: CoveApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        preferencesManager = PreferencesManager(this)
        apiClient = ApiClient(preferencesManager)
        webSocketManager = WebSocketManager(preferencesManager)
        webRTCManager = WebRTCManager(this, webSocketManager)
        rawUdpVoiceManager = RawUdpVoiceManager()

        notificationHelper = NotificationHelper(this)
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
                notificationHelper.showMessage(m.channelId, title, channel?.isDirectMessage == false, sender, m.previewText())
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
