package com.nodetalk.client.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.nodetalk.client.CoveApp
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.ui.components.ButtonSize
import com.nodetalk.client.ui.components.ButtonVariant
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.CoveDialog
import com.nodetalk.client.ui.components.CoveListRow
import com.nodetalk.client.ui.components.CoveTextField
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Spacing

/** Picks the conversation a message is forwarded to; [onPick] gets the target channel id. */
@Composable
fun ForwardDialog(currentChannelId: String, onDismiss: () -> Unit, onPick: (channelId: String) -> Unit) {
    val app = CoveApp.instance
    val me = app.preferencesManager.userId
    var channels by remember { mutableStateOf<List<Channel>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { app.apiClient.getChannels().onSuccess { channels = it } }
    val shown = channels.filter { it.displayName(me).contains(query, ignoreCase = true) }

    CoveDialog(onDismiss, title = "Forward to…") {
        Column(Modifier.padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            CoveTextField(query, { query = it }, placeholder = "Search...", height = 40.dp)
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(shown, key = { it.id }) { ch ->
                    val peer = if (ch.isDirectMessage) ch.members.firstOrNull { it != me } else null
                    CoveListRow(
                        title = ch.displayName(me) + if (ch.id == currentChannelId) "  ·  here" else "",
                        onClick = { onPick(ch.id) },
                        leading = {
                            if (peer != null) UserAvatar(peer, size = 36.dp, avatarId = ch.memberAvatars[peer])
                            else InitialsAvatar(ch.id, ch.name, size = 36.dp)
                        }
                    )
                }
            }
        }
    }
}

/** Read-only group profile (what the web header opens): avatar, name, description, privacy and members. */
@Composable
fun ChannelProfileDialog(channel: Channel, me: String, onDismiss: () -> Unit, onMembers: () -> Unit, onSettings: () -> Unit) {
    val c = CoveTheme.extendedColors
    CoveDialog(onDismiss, title = "Group profile") {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialsAvatar(channel.id, channel.name, size = 64.dp)
                Spacer(Modifier.width(Spacing.md))
                Column {
                    Text(channel.name.ifBlank { channel.displayName(me) }, color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold)
                    Text(
                        (if (channel.isPrivate) "Private" else "Public") + " · ${channel.members.size} members",
                        color = c.textMuted, fontSize = CoveType.label.fontSize
                    )
                }
            }
            if (channel.description.isNotBlank()) {
                Text("ABOUT", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
                Text(channel.description, color = c.textPrimary, fontSize = CoveType.body.fontSize)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
                CoveButton("Members", onMembers, Modifier.weight(1f), variant = ButtonVariant.Secondary, size = ButtonSize.Md)
                CoveButton("Settings", onSettings, Modifier.weight(1f), variant = ButtonVariant.Outline, size = ButtonSize.Md)
            }
        }
    }
}
