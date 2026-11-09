package com.cove.chat.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.emoji.EmojiEngine
import com.cove.chat.emoji.EmojiView
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.CoveSwitchRow
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.launch

private val StyleNames = mapOf("native" to "Device emoji", "noto" to "Noto", "twemoji" to "Twemoji", "blobmoji" to "Blobmoji", "fluent" to "Fluent Flat", "fxemoji" to "FxEmojis")

private fun megabytes(bytes: Long) = "%.1f MB".format(bytes / 1048576.0)

/**
 * Settings > Appearance > Emoji: the styles the admin enabled (Noto ships in the app, the others download on first
 * use and are cached) and the "Animated emoji" switch. The style is per device.
 */
@Composable
fun EmojiSettingsSection() {
    val c = CoveTheme.extendedColors
    val prefs = CoveApp.instance.preferencesManager
    val scope = rememberCoroutineScope()
    var animated by remember { mutableStateOf(prefs.animatedEmoji) }
    // Reading the counters makes the list follow downloads and server changes.
    EmojiEngine.epoch
    val active = EmojiEngine.activeStyleId
    val downloading = EmojiEngine.downloading
    val infos = EmojiEngine.stylesResponse?.styles.orEmpty().associateBy { it.id }

    Text("EMOJI STYLE", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(Spacing.md))
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        EmojiEngine.enabledStyles.forEach { id ->
            val on = id == active
            val info = infos[id]
            val ready = EmojiEngine.isAvailable(id)
            CoveListRow(
                title = StyleNames[id] ?: id,
                subtitle = when {
                    id == EmojiEngine.NATIVE -> "Uses your phone's own emoji font."
                    id in downloading -> "Downloading…"
                    !ready && info != null -> "Download ${megabytes(info.sheetBytes + info.indexBytes)}"
                    else -> info?.license
                },
                selected = on,
                onClick = { scope.launch { EmojiEngine.select(id) } },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(Spacing.md),
                leading = { EmojiView("😀", 28.dp) },
                trailing = if (id in downloading) ({ CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp)) }) else null,
            )
        }
    }
    EmojiEngine.lastError?.let { Text("Couldn't download the style: $it", color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = CoveType.caption.fontSize, modifier = Modifier.padding(top = Spacing.xs)) }
    Spacer(Modifier.height(Spacing.lg))
    CoveSwitchRow(
        title = "Animated emoji", caption = "A single emoji plays its animation in chat. Turns off when the system removes animations.",
        checked = animated, onChange = { animated = it; prefs.animatedEmoji = it }
    )
}

