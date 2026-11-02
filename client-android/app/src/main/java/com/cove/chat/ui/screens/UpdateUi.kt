package com.cove.chat.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.data.update.InstallResult
import com.cove.chat.data.update.UpdateOffer
import com.cove.chat.data.update.UpdateUi
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveSwitchRow
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import kotlinx.coroutines.launch

/** The offer behind the current state, if any. */
private fun UpdateUi.offer(): UpdateOffer? = when (this) {
    is UpdateUi.Available -> offer
    is UpdateUi.Downloading -> offer
    is UpdateUi.Ready -> offer
    is UpdateUi.Failed -> offer
    UpdateUi.Idle -> null
}

/** Small dot used as the "something new" badge. */
@Composable
private fun UpdateDot() {
    Box(Modifier.size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
}

/**
 * First row of the Settings menu when a newer version exists: a quiet entry with a dot, never a dialog. Renders
 * nothing otherwise or in store builds.
 */
@Composable
fun UpdateSettingsEntry(onClick: () -> Unit) {
    val updates = CoveApp.instance.updateManager
    val state by updates.state.collectAsState()
    val offer = state.offer()
    if (!updates.enabled || offer == null) return
    val c = CoveTheme.extendedColors
    Row(
        Modifier.fillMaxWidth().clip(CoveShapes.lg).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.SystemUpdate, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text("Update available", color = c.textPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Medium)
            Text("Cove ${offer.version}", color = c.textMuted, fontSize = CoveType.caption.fontSize)
        }
        UpdateDot()
    }
}

/**
 * One-time card at the top of the chat list. Tapping opens the update page; the cross hides it for this version
 * (the Settings entry stays). Never blocks the list.
 */
@Composable
fun UpdateChatCard(onOpen: () -> Unit) {
    val updates = CoveApp.instance.updateManager
    val state by updates.state.collectAsState()
    val offer = state.offer()
    var dismissed by remember { mutableStateOf<String?>(null) }
    if (!updates.enabled || offer == null || dismissed == offer.version || !updates.cardVisible(offer.version)) return
    val c = CoveTheme.extendedColors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .clip(CoveShapes.lg)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f))
            .clickable(onClick = onOpen)
            .padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.SystemUpdate, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("Update available", color = c.textPrimary, fontSize = CoveType.label.fontSize, fontWeight = FontWeight.Medium)
            Text("Cove ${offer.version}", color = c.textMuted, fontSize = CoveType.caption.fontSize)
        }
        Box(
            Modifier.size(40.dp).clickable { updates.dismissCard(offer.version); dismissed = offer.version },
            contentAlignment = Alignment.Center
        ) { Icon(Icons.Outlined.Close, "Dismiss", tint = c.textMuted, modifier = Modifier.size(18.dp)) }
    }
}

/**
 * Settings > App updates: what is new, Download with progress, Install (hands the verified APK to Android's
 * installer), and the opt-in "download automatically on Wi-Fi" switch. Nothing is installed without the user.
 */
@Composable
fun UpdatePage() {
    val app = CoveApp.instance
    val updates = app.updateManager
    val prefs = app.preferencesManager
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by updates.state.collectAsState()
    var autoDownload by remember { mutableStateOf(prefs.updateAutoDownload) }
    var checking by remember { mutableStateOf(false) }

    if (!updates.enabled) {
        Text("Updates for this build come from the app store.", color = c.textMuted, fontSize = CoveType.body.fontSize)
        return
    }
    LaunchedEffect(Unit) { updates.check() }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val offer = state.offer()
        if (offer == null) {
            Text(
                if (state is UpdateUi.Failed) (state as UpdateUi.Failed).message else "Cove is up to date.",
                color = c.textMuted, fontSize = CoveType.body.fontSize
            )
        } else {
            Text("Cove ${offer.version}", color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold)
            if (offer.notes.isNotBlank()) Text(offer.notes.take(1200), color = c.textMuted, fontSize = CoveType.label.fontSize)
            when (val s = state) {
                is UpdateUi.Downloading -> {
                    LinearProgressIndicator(progress = { s.percent / 100f }, modifier = Modifier.fillMaxWidth().height(6.dp))
                    Row {
                        Text("Downloading…", color = c.textMuted, fontSize = CoveType.caption.fontSize)
                        Spacer(Modifier.width(6.dp))
                        Text("${s.percent}%", color = c.textMuted, fontSize = CoveType.caption.fontSize)
                    }
                }
                is UpdateUi.Ready -> CoveButton("Install update", onClick = {
                    when (updates.install(context)) {
                        InstallResult.NeedsPermission -> I18nToast.make(context, "Allow installs from Cove, then tap Install again.", android.widget.Toast.LENGTH_LONG).show()
                        InstallResult.Failed -> I18nToast.make(context, "The update could not be installed.", android.widget.Toast.LENGTH_LONG).show()
                        else -> Unit
                    }
                })
                is UpdateUi.Failed -> {
                    Text(s.message, color = MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize)
                    CoveButton("Try again", onClick = { scope.launch { updates.download() } })
                }
                else -> if (offer.directInstall) {
                    CoveButton("Download", onClick = { scope.launch { updates.download() } })
                } else {
                    Text("This release cannot be installed directly from your version. Install an earlier release first.", color = c.textMuted, fontSize = CoveType.label.fontSize)
                }
            }
            if (offer.releaseUrl.isNotBlank()) {
                Text(
                    "View release notes", color = MaterialTheme.colorScheme.primary, fontSize = CoveType.label.fontSize,
                    modifier = Modifier.clickable { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(offer.releaseUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                )
            }
        }
        CoveButton(
            if (checking) "Checking…" else "Check now", variant = ButtonVariant.Outline, size = ButtonSize.Sm, enabled = !checking,
            onClick = { scope.launch { checking = true; updates.check(force = true); checking = false } }
        )
        CoveSwitchRow(
            "Download updates automatically", autoDownload,
            caption = "Off by default. Cove only checks for updates; turn this on to also download them on Wi-Fi. Installing always needs your tap."
        ) { autoDownload = it; prefs.updateAutoDownload = it }
    }
}
