package com.cove.chat.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.cove.chat.CoveApp
import com.cove.chat.service.CallService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Handles the buttons on message and call notifications without opening the app. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? CoveApp ?: return
        // The ongoing-call notification buttons carry no channel id.
        when (intent.action) {
            CallService.ACTION_MUTE -> { app.webRTCManager.toggleMute(); return }
            NotificationHelper.ACTION_DECLINE_WHISPER -> {
                val sid = intent.getStringExtra(NotificationHelper.EXTRA_WHISPER_ID) ?: return
                app.whisperManager.declineById(sid)
                return
            }
            CallService.ACTION_LEAVE -> { app.webRTCManager.leaveCall(); CallService.stop(context); return }
        }
        val channelId = intent.getStringExtra(NotificationHelper.EXTRA_CHANNEL_ID) ?: return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                when (intent.action) {
                    NotificationHelper.ACTION_REPLY -> {
                        val text = RemoteInput.getResultsFromIntent(intent)
                            ?.getCharSequence(NotificationHelper.KEY_REPLY)?.toString()?.trim()
                        if (!text.isNullOrEmpty()) {
                            // The socket is kept open by ConnectionService; the text is encrypted with the channel key as usual.
                            if (app.webSocketManager.sendChatMessage(channelId, text)) {
                                app.notificationHelper.onReplySent(channelId, text)
                            } else {
                                app.notificationHelper.showMessage(
                                    channelId, "Cove", false, "Cove", "Couldn't send your reply. Open the app and try again."
                                )
                            }
                        }
                    }
                    NotificationHelper.ACTION_MARK_READ -> {
                        app.webSocketManager.sendReadReceipt(channelId)
                        app.notificationHelper.clear(channelId)
                    }
                    NotificationHelper.ACTION_DISMISSED -> app.notificationHelper.dismissed(channelId)
                    NotificationHelper.ACTION_DECLINE_CALL -> CallCoordinator.decline(app, channelId)
                }
            } finally {
                pending.finish()
            }
        }
    }
}
