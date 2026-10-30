package com.cove.chat.ui.screens

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.CreateChannelRequest
import com.cove.chat.data.model.InvitePreview
import com.cove.chat.data.model.UserSummary
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.ChannelAvatar
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Finds channel invite links (`.../join/<code>`) in message text, same rule as the web `MessageItem`. */
object InviteLinks {
    private val pattern = Regex("/join/([a-zA-Z0-9-]+)")

    /** The invite code of the first `/join/<code>` link in [text], or null. */
    fun code(text: String): String? = pattern.find(text)?.groupValues?.get(1)

    /** The text sent to a friend (or shared) for an invite [url]. */
    fun shareText(channelName: String, url: String) = "Join $channelName on Cove: $url"
}

/**
 * Join card for an invite link: loads the channel's name, photo, description and member count from the server and
 * offers Join (or Open when you are already a member). Joining refreshes the channel list and opens the chat.
 */
@Composable
fun InviteCard(code: String, onOpenChannel: (channelId: String, name: String) -> Unit, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val api = app.apiClient
    val me = app.preferencesManager.userId
    val scope = rememberCoroutineScope()
    var preview by remember(code) { mutableStateOf<InvitePreview?>(null) }
    var loadError by remember(code) { mutableStateOf<String?>(null) }
    var joining by remember(code) { mutableStateOf(false) }
    var joinError by remember(code) { mutableStateOf<String?>(null) }

    LaunchedEffect(code) {
        api.previewInvite(code).fold(
            onSuccess = { preview = it },
            onFailure = { loadError = it.message ?: "This invite link is invalid or has expired." }
        )
    }

    Column(
        modifier.widthIn(max = 320.dp).fillMaxWidth().clip(CoveShapes.lg).background(c.card).border(1.dp, c.border, CoveShapes.lg).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm)
    ) {
        val p = preview
        when {
            p != null -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ChannelAvatar(p.id, p.name, p.avatarId, size = 48.dp)
                    Spacer(Modifier.width(Spacing.md))
                    Column(Modifier.weight(1f)) {
                        Text(p.name, color = c.textPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${p.memberCount} members · ${if (p.isPrivate) "Private" else "Public"}", color = c.textMuted, fontSize = CoveType.caption.fontSize)
                    }
                }
                if (p.description.isNotBlank()) Text(p.description, color = c.textMuted, fontSize = CoveType.label.fontSize, maxLines = 3, overflow = TextOverflow.Ellipsis)
                joinError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = CoveType.caption.fontSize) }
                CoveButton(
                    if (p.alreadyMember) "Open" else "Join", modifier = Modifier.fillMaxWidth(), size = ButtonSize.Sm, loading = joining,
                    variant = if (p.alreadyMember) ButtonVariant.Secondary else ButtonVariant.Default,
                    onClick = {
                        if (p.alreadyMember) { onOpenChannel(p.id, p.name); return@CoveButton }
                        joining = true
                        scope.launch {
                            api.joinChannel(code).fold(
                                onSuccess = { ch -> joinError = null; onOpenChannel(ch.id, ch.displayName(me)) },
                                onFailure = { joinError = it.message ?: "Couldn't join." }
                            )
                            joining = false
                        }
                    }
                )
            }
            loadError != null -> Text(loadError.orEmpty(), color = c.textMuted, fontSize = CoveType.label.fontSize)
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 2.dp, modifier = Modifier.padding(end = Spacing.md).height(18.dp).width(18.dp))
                Text("Loading invitation…", color = c.textMuted, fontSize = CoveType.label.fontSize)
            }
        }
    }
}

/**
 * Lets the user pick friends and sends each of them a direct message with [message] (an invite link). A new DM's
 * channel key arrives over the socket a moment after the DM is created, so sending retries briefly.
 */
@Composable
fun FriendPickerDialog(message: String, onDismiss: () -> Unit) {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val api = app.apiClient
    val me = app.preferencesManager.userId.orEmpty()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var friends by remember { mutableStateOf<List<UserSummary>?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    var sending by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        api.getRelationships().fold(
            onSuccess = { list -> friends = list.filter { it.type == "friend" }.mapNotNull { it.user } },
            onFailure = { friends = emptyList() }
        )
    }

    suspend fun sendTo(friendId: String): Boolean {
        val dm = api.createChannel(CreateChannelRequest(name = "", members = listOf(me, friendId), isPrivate = true)).getOrNull() ?: return false
        repeat(8) {
            if (app.webSocketManager.sendChatMessage(dm.id, message)) return true
            delay(300)
        }
        return false
    }

    CoveDialog(onDismiss, title = "Send to friends") {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            when (val list = friends) {
                null -> CircularProgressIndicator(strokeWidth = 2.dp)
                else -> if (list.isEmpty()) {
                    Text("You have no friends to send this to yet.", color = c.textMuted, fontSize = CoveType.label.fontSize)
                } else LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(list, key = { it.id }) { u ->
                        CoveListRow(
                            title = u.username,
                            contentPadding = PaddingValues(vertical = Spacing.xs),
                            onClick = { if (u.id in picked) picked.remove(u.id) else picked.add(u.id) },
                            leading = { UserAvatar(u.id, size = 36.dp, avatarId = u.avatarId) },
                            trailing = { if (u.id in picked) Icon(Icons.Outlined.Check, "Selected", tint = MaterialTheme.colorScheme.primary) }
                        )
                    }
                }
            }
            CoveButton(
                "Send", modifier = Modifier.fillMaxWidth(), loading = sending, enabled = picked.isNotEmpty(),
                onClick = {
                    sending = true
                    val targets = picked.toList()
                    scope.launch {
                        var ok = 0
                        targets.forEach { if (sendTo(it)) ok++ }
                        I18nToast.make(context, if (ok == targets.size) "Invitation sent" else "Couldn't send to everyone.", Toast.LENGTH_SHORT).show()
                        sending = false
                        if (ok > 0) onDismiss()
                    }
                }
            )
        }
    }
}
