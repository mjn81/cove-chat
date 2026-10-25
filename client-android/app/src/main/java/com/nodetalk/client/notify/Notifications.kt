package com.nodetalk.client.notify

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import com.nodetalk.client.MainActivity
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.ui.components.t

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

/**
 * Native notifications for NodeTalk. There is no push service on a self-hosted server, so these are raised by the
 * app's own WebSocket (kept alive by `ConnectionService`). Messages use `MessagingStyle` with inline reply and
 * mark-as-read actions and are grouped; incoming DM calls raise a ringing, heads-up call notification with
 * Answer / Decline actions.
 */
class NotificationHelper(private val app: Application) {
    private val manager = NotificationManagerCompat.from(app)

    /** One line of a conversation notification (kept in memory only; cleared when the chat is read). */
    private class Line(val sender: String?, val text: String, val time: Long)
    private class Conversation(var title: String, var isGroup: Boolean) { val lines = ArrayList<Line>(); var unread = 0 }
    private val conversations = LinkedHashMap<String, Conversation>()

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_MESSAGES, t("Messages"), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "New messages in your conversations"
                    enableLights(true); lightColor = Color.rgb(0x58, 0x65, 0xF2)
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_CALLS, t("Incoming calls"), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Rings when a friend calls you"
                    setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                    )
                    enableVibration(true); vibrationPattern = longArrayOf(0, 700, 500, 700, 500, 700)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_SERVICE, t("Background connection"), NotificationManager.IMPORTANCE_MIN).apply {
                    description = "Keeps NodeTalk connected so messages and calls arrive while the app is closed"
                    setShowBadge(false)
                }
            )
        }
        // Track whether any activity is visible so notifications fire only when they are useful.
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

    private fun canNotify(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openChatIntent(channelId: String, name: String, requestCode: Int): PendingIntent {
        val open = Intent(app, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_CHANNEL_ID, channelId)
            putExtra(EXTRA_CHANNEL_NAME, name)
        }
        return PendingIntent.getActivity(app, requestCode, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun actionIntent(action: String, channelId: String, mutable: Boolean = false): PendingIntent {
        val i = Intent(app, NotificationActionReceiver::class.java).setAction(action).putExtra(EXTRA_CHANNEL_ID, channelId)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
        return PendingIntent.getBroadcast(app, (action + channelId).hashCode(), i, flags)
    }

    /**
     * Shows (or updates) the notification for [channelId]. [sender] is the author's display name (null for the
     * user's own lines); DMs read as a plain chat, groups get a conversation title.
     */
    fun showMessage(channelId: String, title: String, isGroup: Boolean, sender: String, text: String, silent: Boolean = false) {
        val prefs = (app as NodeTalkApp).preferencesManager
        if (!prefs.notificationsEnabled || !canNotify()) return
        val convo = conversations.getOrPut(channelId) { Conversation(title, isGroup) }
        convo.title = title; convo.isGroup = isGroup
        convo.lines.add(Line(sender, text, System.currentTimeMillis()))
        convo.unread++
        while (convo.lines.size > MAX_LINES) convo.lines.removeAt(0)
        post(channelId, convo, alert = !silent && prefs.notificationSound)
    }

    /** Appends the user's own inline reply to the visible notification without alerting again. */
    fun onReplySent(channelId: String, text: String) {
        val convo = conversations[channelId] ?: return
        convo.lines.add(Line(null, text, System.currentTimeMillis()))
        while (convo.lines.size > MAX_LINES) convo.lines.removeAt(0)
        post(channelId, convo, alert = false)
    }

    private fun post(channelId: String, convo: Conversation, alert: Boolean) {
        val me = Person.Builder().setName(t("You")).setKey("me").build()
        val style = NotificationCompat.MessagingStyle(me)
        if (convo.isGroup) style.setConversationTitle(convo.title).setGroupConversation(true)
        convo.lines.forEach { l ->
            val person = l.sender?.let { Person.Builder().setName(it).setKey(it).build() } // null = me
            style.addMessage(l.text, l.time, person)
        }
        val reply = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send, t("Reply"), actionIntent(ACTION_REPLY, channelId, mutable = true)
        ).addRemoteInput(RemoteInput.Builder(KEY_REPLY).setLabel(t("Reply")).build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).setShowsUserInterface(false).build()
        val markRead = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_view, t("Mark as read"), actionIntent(ACTION_MARK_READ, channelId)
        ).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).setShowsUserInterface(false).build()

        val n = NotificationCompat.Builder(app, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setColor(0xFF5865F2.toInt())
            .setStyle(style)
            .setContentTitle(convo.title)
            .setContentText(convo.lines.lastOrNull()?.text)
            .setContentIntent(openChatIntent(channelId, convo.title, channelId.hashCode()))
            .setDeleteIntent(actionIntent(ACTION_DISMISSED, channelId))
            .addAction(reply).addAction(markRead)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setNumber(convo.unread) // launcher icon badge count (shown by Pixel/Samsung/etc. launchers)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(GROUP_MESSAGES)
            .setOnlyAlertOnce(!alert)
            .setSilent(!alert)
            .setWhen(convo.lines.last().time).setShowWhen(true)
            .build()
        manager.notify(channelId.hashCode(), n)
        postSummary()
    }

    /** Group summary so several conversations collapse into one expandable stack. */
    private fun postSummary() {
        if (conversations.size < 2) { manager.cancel(SUMMARY_ID); return }
        val inbox = NotificationCompat.InboxStyle().setBigContentTitle("NodeTalk")
        conversations.values.forEach { inbox.addLine("${it.title}: ${it.lines.lastOrNull()?.text.orEmpty()}") }
        val n = NotificationCompat.Builder(app, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setColor(0xFF5865F2.toInt())
            .setStyle(inbox)
            .setContentTitle("NodeTalk")
            .setContentText("${conversations.size} conversations")
            .setGroup(GROUP_MESSAGES).setGroupSummary(true)
            .setNumber(conversations.values.sumOf { it.unread })
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(app, 0, Intent(app, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        manager.notify(SUMMARY_ID, n)
    }

    /** Clears the notification (and its in-memory history) once the chat is read or opened. */
    fun clear(channelId: String) {
        conversations.remove(channelId)
        manager.cancel(channelId.hashCode())
        postSummary()
    }

    /** Called when the user swipes a conversation notification away. */
    fun dismissed(channelId: String) {
        conversations.remove(channelId)
        postSummary()
    }

    // ── Calls ────────────────────────────────────────────────────────────────

    /** Heads-up ringing notification for an incoming DM call, with Answer and Decline actions. */
    fun showIncomingCall(channelId: String, callerName: String) {
        if (!canNotify()) return
        val answer = Intent(app, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            action = ACTION_ANSWER_CALL
            putExtra(EXTRA_CHANNEL_ID, channelId)
            putExtra(EXTRA_CHANNEL_NAME, callerName)
        }
        val answerPi = PendingIntent.getActivity(app, ("answer" + channelId).hashCode(), answer, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val person = Person.Builder().setName(callerName).setImportant(true).build()
        val builder = NotificationCompat.Builder(app, CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setColor(0xFF5865F2.toInt())
            .setContentTitle(t("Incoming call"))
            .setContentText("$callerName ${t("is calling you…")}")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(CALL_RING_TIMEOUT_MS)
            .setContentIntent(answerPi)
            .setFullScreenIntent(answerPi, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, actionIntent(ACTION_DECLINE_CALL, channelId), answerPi))
        val n = builder.build()
        n.flags = n.flags or Notification.FLAG_INSISTENT // keep ringing until answered/declined/timeout
        manager.notify(CALL_ID_BASE + channelId.hashCode(), n)
    }

    fun cancelIncomingCall(channelId: String) = manager.cancel(CALL_ID_BASE + channelId.hashCode())

    companion object {
        const val CHANNEL_MESSAGES = "messages"
        const val CHANNEL_CALLS = "calls"
        const val CHANNEL_SERVICE = "background_connection"
        const val GROUP_MESSAGES = "nodetalk_messages"
        const val SUMMARY_ID = 1
        const val CALL_ID_BASE = 100_000
        const val MAX_LINES = 8
        const val CALL_RING_TIMEOUT_MS = 45_000L

        const val EXTRA_CHANNEL_ID = "open_channel_id"
        const val EXTRA_CHANNEL_NAME = "open_channel_name"
        const val KEY_REPLY = "reply_text"
        const val ACTION_REPLY = "com.nodetalk.client.REPLY"
        const val ACTION_MARK_READ = "com.nodetalk.client.MARK_READ"
        const val ACTION_DISMISSED = "com.nodetalk.client.DISMISSED"
        const val ACTION_DECLINE_CALL = "com.nodetalk.client.DECLINE_CALL"
        const val ACTION_ANSWER_CALL = "com.nodetalk.client.ANSWER_CALL"
    }
}
