package com.cove.chat.ui.screens

import com.cove.chat.ui.components.CoveSegmented
import com.cove.chat.ui.components.Segment
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.CreateChannelRequest
import com.cove.chat.data.model.Relationship
import com.cove.chat.data.model.UserSummary
import com.cove.chat.ui.components.ErrorBanner
import com.cove.chat.ui.components.FieldLabel
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class FriendsTab(val label: String) { Friends("Friends"), Pending("Pending"), Sent("Sent"), Blocked("Blocked") }

/**
 * Settings > Friends. Same model as client-web FriendsTab: friends (`type = friend`), incoming requests
 * (`/relationships/incoming`), sent requests (`type = requested`) and blocked users, plus add-by-username.
 */
@Composable
fun FriendsPage(onOpenChat: (channelId: String, name: String) -> Unit, onStartWhisper: (userId: String, name: String) -> Unit = { _, _ -> }) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val me = CoveApp.instance.preferencesManager.userId.orEmpty()
    val scope = rememberCoroutineScope()

    var tab by remember { mutableStateOf(FriendsTab.Friends) }
    var relationships by remember { mutableStateOf<List<Relationship>>(emptyList()) }
    var incoming by remember { mutableStateOf<List<Relationship>>(emptyList()) }
    var tick by remember { mutableStateOf(0) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tick) {
        api.getRelationships().onSuccess { relationships = it }
        api.getIncomingRequests().onSuccess { incoming = it }
    }
    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        api.searchUsers(query.trim()).onSuccess { r -> results = r.filter { it.id != me } }
    }

    fun act(userId: String, action: String, okMessage: String? = null) {
        scope.launch {
            api.relationshipAction(userId, action).fold(
                onSuccess = { error = null; message = okMessage; tick++ },
                onFailure = { error = it.message; message = null }
            )
        }
    }

    fun startDm(userId: String, name: String) {
        scope.launch {
            api.createChannel(CreateChannelRequest(name = "", members = listOf(me, userId), isPrivate = true)).fold(
                onSuccess = { onOpenChat(it.id, name) },
                onFailure = { error = it.message }
            )
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FieldLabel("Add a friend")
        CoveTextField(query, { query = it }, placeholder = "Search by username")
        results.forEach { u ->
            val already = relationships.any { it.toUserId == u.id && (it.type == "friend" || it.type == "requested") }
            CoveListRow(title = u.username, contentPadding = PaddingValues(vertical = Spacing.xs), leading = { UserAvatar(u.id, size = 36.dp, avatarId = u.avatarId) }, trailing = {
                if (already) Text("Added", color = c.textMuted, fontSize = CoveType.label.fontSize)
                else CoveButton("Add", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.primary, onClick = { act(u.id, "request", "Friend request sent to ${u.username}.") })
            })
        }
        message?.let { Text(it, color = c.statusOnline, fontSize = CoveType.label.fontSize) }
        error?.let { ErrorBanner(it) }

        CoveSegmented(
            FriendsTab.entries.map { t -> Segment(t.label + if (t == FriendsTab.Pending && incoming.isNotEmpty()) " (${incoming.size})" else "") },
            selectedIndex = tab.ordinal, onSelect = { tab = FriendsTab.entries[it] }
        )

        val friends = relationships.filter { it.type == "friend" }
        val sent = relationships.filter { it.type == "requested" }
        val blocked = relationships.filter { it.type == "blocked" }
        when (tab) {
            FriendsTab.Friends -> {
                if (friends.isEmpty()) Text("No friends yet. Search above to add someone.", color = CoveTheme.extendedColors.textMuted, style = CoveType.label, fontWeight = FontWeight.Normal, modifier = Modifier.padding(vertical = Spacing.md))
                friends.forEach { f ->
                    val name = f.user?.username ?: "Unknown"
                    CoveListRow(title = name, contentPadding = PaddingValues(vertical = Spacing.xs), leading = { UserAvatar(f.toUserId, size = 36.dp, avatarId = f.user?.avatarId) }, trailing = {
                        CoveButton("Message", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.primary, onClick = { startDm(f.toUserId, name) })
                        CoveButton("Whisper", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.primary, onClick = { onStartWhisper(f.toUserId, name) })
                        CoveButton("Remove", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.error, onClick = { act(f.toUserId, "remove") })
                    })
                }
            }
            FriendsTab.Pending -> {
                if (incoming.isEmpty()) Text("No pending requests.", color = CoveTheme.extendedColors.textMuted, style = CoveType.label, fontWeight = FontWeight.Normal, modifier = Modifier.padding(vertical = Spacing.md))
                incoming.forEach { r ->
                    CoveListRow(title = r.user?.username ?: "Unknown", contentPadding = PaddingValues(vertical = Spacing.xs), leading = { UserAvatar(r.fromUserId, size = 36.dp, avatarId = r.user?.avatarId) }, trailing = {
                        CoveButton("Accept", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.primary, onClick = { act(r.fromUserId, "accept") })
                        CoveButton("Decline", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.error, onClick = { act(r.fromUserId, "decline") })
                    })
                }
            }
            FriendsTab.Sent -> {
                if (sent.isEmpty()) Text("No outgoing requests.", color = CoveTheme.extendedColors.textMuted, style = CoveType.label, fontWeight = FontWeight.Normal, modifier = Modifier.padding(vertical = Spacing.md))
                sent.forEach { r ->
                    CoveListRow(title = r.user?.username ?: "Unknown", contentPadding = PaddingValues(vertical = Spacing.xs), leading = { UserAvatar(r.toUserId, size = 36.dp, avatarId = r.user?.avatarId) }, trailing = {
                        CoveButton("Cancel", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.error, onClick = { act(r.toUserId, "cancel") })
                    })
                }
            }
            FriendsTab.Blocked -> {
                if (blocked.isEmpty()) Text("You haven't blocked anyone.", color = CoveTheme.extendedColors.textMuted, style = CoveType.label, fontWeight = FontWeight.Normal, modifier = Modifier.padding(vertical = Spacing.md))
                blocked.forEach { r ->
                    CoveListRow(title = r.user?.username ?: "Unknown", contentPadding = PaddingValues(vertical = Spacing.xs), leading = { UserAvatar(r.toUserId, size = 36.dp, avatarId = r.user?.avatarId) }, trailing = {
                        CoveButton("Unblock", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.primary, onClick = { act(r.toUserId, "unblock") })
                    })
                }
            }
        }
    }
}
