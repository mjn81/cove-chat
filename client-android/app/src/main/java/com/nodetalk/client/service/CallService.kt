package com.nodetalk.client.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import com.nodetalk.client.CoveApp
import com.nodetalk.client.MainActivity
import com.nodetalk.client.notify.NotificationActionReceiver
import com.nodetalk.client.ui.components.t
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Foreground service that keeps a call alive in the background. Its type is `microphone` (+ `camera` when the
 * permission is granted) and gains `mediaProjection` while the screen is being shared, which Android 14+ requires
 * to be running *before* the capture starts: [screenReady] flips once the service is in that state. The ongoing
 * call-style notification shows the elapsed time with Mute and Leave buttons and tracks the mute state.
 */
class CallService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var observer: Job? = null
    private var channelName = "Group Call"

    companion object {
        private const val CHANNEL_ID = "nodetalk_active_call_channel"
        private const val NOTIFICATION_ID = 2001
        private const val EXTRA_SCREEN = "screen_share"
        const val ACTION_MUTE = "com.nodetalk.client.CALL_MUTE"
        const val ACTION_LEAVE = "com.nodetalk.client.CALL_LEAVE"

        private val _screenReady = MutableStateFlow(false)
        /** True while the service is running in the foreground with the `mediaProjection` type. */
        val screenReady: StateFlow<Boolean> = _screenReady.asStateFlow()

        /** Starts (or re-types, with [screenShare]) the call service. Safe to call again while running. */
        fun start(context: Context, channelName: String, screenShare: Boolean = false) {
            val intent = Intent(context, CallService::class.java).apply {
                putExtra("channel_name", channelName)
                putExtra(EXTRA_SCREEN, screenShare)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            _screenReady.value = false
            context.stopService(Intent(context, CallService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        channelName = intent?.getStringExtra("channel_name") ?: channelName
        val screen = intent?.getBooleanExtra(EXTRA_SCREEN, false) ?: false
        createNotificationChannel()

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Declaring a type whose runtime permission is missing throws on Android 14+, so only claim what is granted.
            var type = 0
            if (granted(Manifest.permission.RECORD_AUDIO)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (granted(Manifest.permission.CAMERA)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            if (screen) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            runCatching { if (type != 0) startForeground(NOTIFICATION_ID, notification, type) else startForeground(NOTIFICATION_ID, notification) }
                .onFailure { runCatching { startForeground(NOTIFICATION_ID, notification) }.onFailure { stopSelf() } }
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        _screenReady.value = screen

        if (observer == null) {
            val rtc = (application as CoveApp).webRTCManager
            observer = scope.launch {
                launch { rtc.isInCall.collect { if (!it) stopSelf() } }
                combine(rtc.isMuted, rtc.participants, rtc.isScreenSharing, rtc.status) { _, _, _, _ -> Unit }.collect {
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        _screenReady.value = false
        scope.cancel()
        super.onDestroy()
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun createNotificationChannel() {
        val channel = NotificationChannel(CHANNEL_ID, t("Cove Active Call"), NotificationManager.IMPORTANCE_LOW).apply {
            description = t("Shows persistent status while in a Cove audio or video call")
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun action(action: String, requestCode: Int): PendingIntent = PendingIntent.getBroadcast(
        this, requestCode, Intent(this, NotificationActionReceiver::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun buildNotification(): Notification {
        val rtc = (application as CoveApp).webRTCManager
        val muted = rtc.isMuted.value
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = rtc.participants.value.size
        val detail = buildString {
            append(if (rtc.status.value.isNotBlank() && rtc.status.value != "Connected") t(rtc.status.value) else t("In call"))
            if (n > 0) append(" · ").append(t("$n in call"))
            if (rtc.isScreenSharing.value) append(" · ").append(t("Sharing your screen"))
        }
        val person = Person.Builder().setName(channelName).setImportant(true).build()
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(channelName)
            .setContentText(detail)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis() - (android.os.SystemClock.elapsedRealtime() - rtc.callStartedAt))
            .setContentIntent(open)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, action(ACTION_LEAVE, 1)))
            .addAction(android.R.drawable.ic_lock_silent_mode, if (muted) t("Unmute") else t("Mute"), action(ACTION_MUTE, 2))
            .build()
    }
}
