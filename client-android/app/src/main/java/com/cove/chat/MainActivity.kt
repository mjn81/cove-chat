package com.cove.chat

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import android.view.WindowManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.cove.chat.security.AppLock
import com.cove.chat.ui.screens.LockScreen
import com.cove.chat.notify.NotificationHelper
import com.cove.chat.notify.OpenChatRequest
import com.cove.chat.ui.navigation.NavGraph
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.ThemeSettings

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
        com.cove.chat.ui.components.ChatBackgroundSettings.id = CoveApp.instance.preferencesManager.chatBackground
        com.cove.chat.ui.components.AppLanguage.code = CoveApp.instance.preferencesManager.language

        AppLock.init()
        applySecureFlag()

        setContent {
            CoveTheme {
                Box(Modifier.fillMaxSize()) {
                    NavGraph()
                    if (AppLock.locked) LockScreen()
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        AppLock.onForeground()
        applySecureFlag()
    }

    override fun onStop() {
        super.onStop()
        AppLock.onBackground()
    }

    /** With a passcode set, block screenshots and hide the content in the recent-apps view. */
    private fun applySecureFlag() {
        if (AppLock.enabled) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
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
            com.cove.chat.notify.CallCoordinator.answer(CoveApp.instance, com.cove.chat.notify.IncomingCall(id, "", name))
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
