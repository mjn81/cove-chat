package com.nodetalk.client

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.nodetalk.client.notify.NotificationHelper
import com.nodetalk.client.notify.OpenChatRequest
import com.nodetalk.client.ui.navigation.NavGraph
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.ThemeSettings

class MainActivity : ComponentActivity() {

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        // Permissions granted/denied callback
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        checkAndRequestPermissions()
        handleOpenIntent(intent)

        ThemeSettings.dark = CoveApp.instance.preferencesManager.darkTheme
        com.nodetalk.client.ui.components.ChatBackgroundSettings.id = CoveApp.instance.preferencesManager.chatBackground
        com.nodetalk.client.ui.components.AppLanguage.code = CoveApp.instance.preferencesManager.language

        setContent {
            CoveTheme {
                NavGraph()
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        handleOpenIntent(intent)
    }

    /** Notification taps carry the chat to open; NavGraph observes [OpenChatRequest]. */
    private fun handleOpenIntent(intent: android.content.Intent?) {
        // Whisper notification actions: Accept (also tapping the request) and opening a session.
        val whisperId = intent?.getStringExtra(NotificationHelper.EXTRA_WHISPER_ID)
        if (whisperId != null) {
            val whisper = CoveApp.instance.whisperManager
            when (intent.action) {
                NotificationHelper.ACTION_ACCEPT_WHISPER -> { whisper.acceptById(whisperId)?.let { whisper.openRequest = it } }
                NotificationHelper.ACTION_OPEN_WHISPER -> whisper.openRequest = whisperId
            }
            return
        }
        val id = intent?.getStringExtra(NotificationHelper.EXTRA_CHANNEL_ID) ?: return
        val name = intent.getStringExtra(NotificationHelper.EXTRA_CHANNEL_NAME).orEmpty()
        if (intent.action == NotificationHelper.ACTION_ANSWER_CALL) {
            // Answer tapped on the ringing notification (or its full-screen version).
            com.nodetalk.client.notify.CallCoordinator.answer(CoveApp.instance, com.nodetalk.client.notify.IncomingCall(id, "", name))
            return
        }
        OpenChatRequest.channelName = name
        OpenChatRequest.channelId = id
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            requestPermissionsLauncher.launch(needed.toTypedArray())
        }
    }
}
