package com.cove.chat.notify

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.cove.chat.CoveApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A friend ringing you in a direct message. */
class IncomingCall(val channelId: String, val callerId: String, val callerName: String)

/**
 * Detects incoming DM calls from `voice_update` events, mirroring client-web `checkIncomingCall`: a call rings when
 * a DM's call roster becomes non-empty and contains the other person while you are not in it. It posts the native
 * ringing notification (works with the app in the background thanks to `ConnectionService`) and exposes [incoming]
 * so the UI can show its own answer/decline dialog.
 */
object CallCoordinator {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val handled = HashSet<String>()
    private var ringTimeout: Job? = null

    /** Currently ringing call, if any. */
    var incoming by mutableStateOf<IncomingCall?>(null)
        private set

    /** Set by an Answer tap (notification or dialog); the nav graph consumes it and opens the call screen. */
    var pendingAnswer by mutableStateOf<IncomingCall?>(null)

    fun start(app: CoveApp) {
        scope.launch {
            app.webSocketManager.voiceFlow.collect { (channelId, users) ->
                if (users.isEmpty()) {
                    handled.remove(channelId)
                    if (incoming?.channelId == channelId) dismiss(app, channelId)
                } else {
                    check(app, channelId, users)
                }
            }
        }
    }

    private suspend fun check(app: CoveApp, channelId: String, users: List<String>) {
        val me = app.preferencesManager.userId ?: return
        if (channelId in handled || incoming?.channelId == channelId) return
        if (me in users || app.webRTCManager.isInCall.value) return
        val channel = app.apiClient.getChannels().getOrNull()?.firstOrNull { it.id == channelId } ?: return
        // Group channels show "in voice call" but don't ring, like the web client.
        if (!channel.isDirectMessage) return
        val callerId = users.firstOrNull { it != me } ?: return
        if (channel.members.firstOrNull { it != me } != callerId) return
        val name = channel.memberNames[callerId] ?: "Someone"
        incoming = IncomingCall(channelId, callerId, name)
        if (app.preferencesManager.notificationsEnabled) app.notificationHelper.showIncomingCall(channelId, name)
        ringTimeout?.cancel()
        ringTimeout = scope.launch {
            delay(NotificationHelper.CALL_RING_TIMEOUT_MS)
            if (incoming?.channelId == channelId) dismiss(app, channelId)
        }
    }

    /** User answered: stop ringing, remember it was handled, and ask the UI to open the call. */
    fun answer(app: CoveApp, call: IncomingCall) {
        handled.add(call.channelId)
        dismiss(app, call.channelId)
        pendingAnswer = call
    }

    fun decline(app: CoveApp, channelId: String) {
        handled.add(channelId)
        dismiss(app, channelId)
    }

    /** Marks a call as handled when the user joins it from elsewhere (e.g. the phone button in the chat). */
    fun joined(app: CoveApp, channelId: String) {
        handled.add(channelId)
        dismiss(app, channelId)
    }

    private fun dismiss(app: CoveApp, channelId: String) {
        ringTimeout?.cancel()
        if (incoming?.channelId == channelId) incoming = null
        app.notificationHelper.cancelIncomingCall(channelId)
    }
}
