package com.cove.chat.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.FormField
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.CoveSwitchRow
import com.cove.chat.ui.components.CoveSegmented
import com.cove.chat.ui.components.Segment
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import com.cove.chat.ui.components.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.cove.chat.CoveApp
import com.cove.chat.data.model.Channel
import com.cove.chat.data.model.CreateChannelRequest
import com.cove.chat.data.model.ExploreChannel
import com.cove.chat.data.model.UserSummary
import com.cove.chat.ui.components.AppLanguage
import com.cove.chat.ui.components.ErrorBanner
import com.cove.chat.ui.components.FieldLabel
import com.cove.chat.ui.components.InitialsAvatar
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.SectionDivider
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * "New Channel" dialog: name, optional description and private/public. Direct messages are started from the search
 * dialog instead (an unnamed private channel whose members are [me, target]; the backend de-duplicates existing DMs).
 */
@Composable
fun NewConversationDialog(onDismiss: () -> Unit, onCreated: (Channel) -> Unit) {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val api = app.apiClient
    val me = app.preferencesManager.userId.orEmpty()
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isPrivate by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun create(request: CreateChannelRequest) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            api.createChannel(request).fold(
                onSuccess = { onCreated(it) },
                onFailure = { error = it.message; busy = false }
            )
        }
    }

    CoveDialog(
        onDismiss = onDismiss, title = "New Channel",
        footer = {
            CoveButton("Cancel", onDismiss, variant = ButtonVariant.Ghost)
            CoveButton(
                "Create",
                onClick = { create(CreateChannelRequest(name = name.trim(), description = description.trim(), members = listOf(me), isPrivate = isPrivate)) },
                enabled = name.isNotBlank() && !busy
            )
        }
    ) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            error?.let { ErrorBanner(it) }

            run {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    InitialsAvatar(id = name.ifBlank { "new" }, name = name, size = 64.dp)
                    Spacer(Modifier.width(Spacing.lg))
                    FormField("Channel Name", Modifier.weight(1f)) { CoveTextField(name, { name = it }) }
                }
                FormField("Description (optional)") {
                    CoveTextField(description, { description = it }, placeholder = "What is this channel about?")
                }
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(CoveShapes.md)
                        .border(1.dp, c.border, CoveShapes.md)
                        .padding(Spacing.md)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.width(Spacing.md))
                        CoveSwitchRow("Private Channel", isPrivate, caption = "Only invited members can find and join.") { isPrivate = it }
                    }
                    if (isPrivate) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "Note: This channel will not appear in the discoverable \"Explore\" list.",
                            color = c.textMuted, style = CoveType.caption, fontStyle = FontStyle.Italic,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(CoveShapes.md)
                                .background(c.popover)
                                .padding(10.dp)
                        )
                    }
                }
            }
        }
    }
}
