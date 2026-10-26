package com.nodetalk.client

import android.app.Application
import com.nodetalk.client.data.local.PreferencesManager
import com.nodetalk.client.data.remote.ApiClient
import com.nodetalk.client.data.remote.WebSocketManager
import com.nodetalk.client.rtc.RawUdpVoiceManager
import com.nodetalk.client.data.model.previewText
import com.nodetalk.client.notify.ActiveChat
import com.nodetalk.client.notify.CallCoordinator
import com.nodetalk.client.notify.NotificationHelper
import com.nodetalk.client.service.BackgroundConnection
import com.nodetalk.client.rtc.WebRTCManager
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
    lateinit var whisperManager: com.nodetalk.client.whisper.WhisperManager
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
        whisperManager = com.nodetalk.client.whisper.WhisperManager(webSocketManager) { preferencesManager.userId }
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
