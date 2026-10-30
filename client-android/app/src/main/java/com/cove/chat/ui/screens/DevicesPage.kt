package com.cove.chat.ui.screens

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.SessionInfo
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveConfirmDialog
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.EmptyState
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.SectionHeader
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/** Icon that best matches where the session runs. */
private fun deviceIcon(s: SessionInfo): ImageVector = when {
    s.platform == "Android" || s.platform == "iOS" -> Icons.Outlined.Smartphone
    s.appName.contains("Desktop", ignoreCase = true) -> Icons.Outlined.Laptop
    s.platform.isNotBlank() -> Icons.Outlined.Language
    else -> Icons.Outlined.Devices
}

/** "Online now", "5 min ago", "3 h ago", "2 d ago" for an RFC 3339 timestamp; clock skew never goes negative. */
internal fun activeAgo(iso: String, now: Instant = Instant.now()): String {
    val seconds = runCatching { Duration.between(Instant.parse(iso), now).seconds }.getOrDefault(0L).coerceAtLeast(0L)
    return when {
        seconds < 60 -> "Online now"
        seconds < 3_600 -> "${seconds / 60} min ago"
        seconds < 86_400 -> "${seconds / 3_600} h ago"
        else -> "${seconds / 86_400} d ago"
    }
}

/** The non-empty detail fragments under a device name: app, IP address and location. */
private fun details(s: SessionInfo): String =
    listOf(s.appName, s.ip, listOf(s.city, s.country).filter { it.isNotBlank() }.joinToString(", "))
        .filter { it.isNotBlank() }.joinToString(" · ")

/**
 * Settings > Devices, Telegram-style: this phone on top, every other signed-in device below with where and when it
 * was last active, and buttons to terminate one or all of the others. Termination is enforced by the server, which
 * also closes that device's live connection.
 */
@Composable
fun DevicesPage() {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sessions by remember { mutableStateOf<List<SessionInfo>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<SessionInfo?>(null) }
    var confirmAll by remember { mutableStateOf(false) }

    fun load() {
        scope.launch { api.getSessions().onSuccess { sessions = it; failed = false }.onFailure { failed = true } }
    }
    fun toast(msg: String) = I18nToast.make(context, msg, Toast.LENGTH_SHORT).show()
    LaunchedEffect(Unit) { load() }

    val list = sessions
    val current = list?.firstOrNull { it.current }
    val others = list?.filter { !it.current }.orEmpty()

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text("Every device signed in to your account. Terminate any session you don't recognize.", color = c.textMuted, fontSize = CoveType.label.fontSize)

        if (failed && list == null) Text("Couldn't load your devices.", color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize)

        current?.let {
            SectionHeader("This device", loading = false)
            Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp))) {
                CoveListRow(
                    title = it.deviceName.ifBlank { "Unknown device" },
                    subtitle = details(it),
                    leading = { Icon(deviceIcon(it), null, tint = c.textMuted, modifier = Modifier.size(22.dp)) },
                    contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md)
                )
            }
            if (others.isNotEmpty()) {
                CoveButton(
                    text = "Terminate all other sessions",
                    onClick = { confirmAll = true },
                    variant = ButtonVariant.Destructive,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        if (list != null && others.isEmpty()) {
            EmptyState(title = "No other devices", message = "You're only signed in here.", icon = Icons.Outlined.Devices)
        }

        if (others.isNotEmpty()) {
            SectionHeader("Active sessions", loading = false)
            Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp))) {
                others.forEach { s ->
                    CoveListRow(
                        title = s.deviceName.ifBlank { "Unknown device" },
                        subtitle = listOf(details(s), activeAgo(s.lastActiveAt)).filter { it.isNotBlank() }.joinToString(" · "),
                        leading = { Icon(deviceIcon(s), null, tint = c.textMuted, modifier = Modifier.size(22.dp)) },
                        trailing = { CoveIconButton(Icons.Outlined.Close, "Terminate session", { pending = s }) },
                        contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md)
                    )
                }
            }
        }
        Spacer(Modifier.height(Spacing.xl))
    }

    if (confirmAll) {
        CoveConfirmDialog(
            title = "Terminate all other sessions",
            message = "Every device except this one will be signed out.",
            confirmLabel = "Terminate all",
            destructive = true,
            onConfirm = {
                confirmAll = false
                scope.launch {
                    api.terminateOtherSessions()
                        .onSuccess { toast("Other sessions terminated"); load() }
                        .onFailure { toast(it.message ?: "Couldn't load your devices.") }
                }
            },
            onDismiss = { confirmAll = false }
        )
    }
    pending?.let { s ->
        CoveConfirmDialog(
            title = "Terminate session",
            message = "Sign ${s.deviceName.ifBlank { "this device" }} out of your account?",
            confirmLabel = "Terminate session",
            destructive = true,
            onConfirm = {
                pending = null
                scope.launch {
                    api.terminateSession(s.id)
                        .onSuccess { toast("Session terminated"); load() }
                        .onFailure { toast(it.message ?: "Couldn't load your devices.") }
                }
            },
            onDismiss = { pending = null }
        )
    }
}
