package com.nodetalk.client.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.nodetalk.client.MainActivity
import com.nodetalk.client.CoveApp
import com.nodetalk.client.notify.NotificationHelper

/**
 * Keeps the WebSocket connected while the app is in the background so messages and calls can raise notifications
 * (the server has no push service). It shows one silent, minimised notification that the user can hide from system
 * settings, and is started/stopped by [BackgroundConnection] according to login state and the Settings toggle.
 */
class ConnectionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as CoveApp
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification: Notification = NotificationCompat.Builder(this, NotificationHelper.CHANNEL_SERVICE)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Cove")
            .setContentText("Connected — you'll get messages and calls")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true).setSilent(true).setShowWhen(false)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        app.webSocketManager.connect()
        return START_STICKY
    }

    companion object {
        private const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, ConnectionService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ConnectionService::class.java))
        }
    }
}

/** Starts or stops [ConnectionService] to match "signed in" and the user's background-connection preference. */
object BackgroundConnection {
    fun sync(context: Context) {
        val app = context.applicationContext as CoveApp
        val prefs = app.preferencesManager
        if (!prefs.authToken.isNullOrBlank() && prefs.keepConnected) ConnectionService.start(app) else ConnectionService.stop(app)
    }
}
