package com.nodetalk.client.notify

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.nodetalk.client.MainActivity

/** What the user is looking at right now; used to suppress notifications for the open chat. */
object ActiveChat {
    @Volatile var channelId: String? = null
    @Volatile var foreground: Boolean = false
}

/** A chat the app was asked to open (notification tap). Observed by the nav graph. */
object OpenChatRequest {
    var channelId by mutableStateOf<String?>(null)
    var channelName by mutableStateOf("")
}

/** Local message notifications (no push service: works while the process, and so the socket, is alive). */
class NotificationHelper(private val app: Application) {
    private val manager = NotificationManagerCompat.from(app)

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH)
            (app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
        // Track whether any activity is visible so notifications fire only when it is useful.
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(a: Activity) { started++; ActiveChat.foreground = true }
            override fun onActivityStopped(a: Activity) { started--; if (started <= 0) ActiveChat.foreground = false }
            override fun onActivityCreated(a: Activity, s: Bundle?) {}
            override fun onActivityResumed(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, s: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }

    /** Shows (or replaces) the notification for [channelId]. Message bodies are decrypted client-side first. */
    fun showMessage(channelId: String, channelName: String, body: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val open = Intent(app, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_CHANNEL_ID, channelId)
            putExtra(EXTRA_CHANNEL_NAME, channelName)
        }
        val pi = PendingIntent.getActivity(
            app, channelId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(app, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(channelName)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()
        manager.notify(channelId.hashCode(), n)
    }

    fun clear(channelId: String) = manager.cancel(channelId.hashCode())

    companion object {
        const val CHANNEL_ID = "messages"
        const val EXTRA_CHANNEL_ID = "open_channel_id"
        const val EXTRA_CHANNEL_NAME = "open_channel_name"
    }
}
