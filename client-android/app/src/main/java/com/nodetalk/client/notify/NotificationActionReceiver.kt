package com.nodetalk.client.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.nodetalk.client.NodeTalkApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Handles the buttons on message and call notifications without opening the app. */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? NodeTalkApp ?: return
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
                                    channelId, "NodeTalk", false, "NodeTalk", "Couldn't send your reply. Open the app and try again."
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
