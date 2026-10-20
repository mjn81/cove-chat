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
import com.nodetalk.client.ui.theme.NodeTalkTheme
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

        ThemeSettings.dark = NodeTalkApp.instance.preferencesManager.darkTheme
        com.nodetalk.client.ui.components.AppLanguage.code = NodeTalkApp.instance.preferencesManager.language

        setContent {
            NodeTalkTheme {
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
        val id = intent?.getStringExtra(NotificationHelper.EXTRA_CHANNEL_ID) ?: return
        OpenChatRequest.channelName = intent.getStringExtra(NotificationHelper.EXTRA_CHANNEL_NAME).orEmpty()
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
