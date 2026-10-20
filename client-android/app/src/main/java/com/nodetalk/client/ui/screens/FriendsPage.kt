package com.nodetalk.client.ui.screens

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
import com.nodetalk.client.ui.components.Text
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
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.data.model.CreateChannelRequest
import com.nodetalk.client.data.model.Relationship
import com.nodetalk.client.data.model.UserSummary
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FieldLabel
import com.nodetalk.client.ui.components.NTTextField
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class FriendsTab(val label: String) { Friends("Friends"), Pending("Pending"), Sent("Sent"), Blocked("Blocked") }

/**
 * Settings > Friends. Same model as client-web FriendsTab: friends (`type = friend`), incoming requests
 * (`/relationships/incoming`), sent requests (`type = requested`) and blocked users, plus add-by-username.
 */
@Composable
fun FriendsPage(onOpenChat: (channelId: String, name: String) -> Unit, onStartWhisper: (userId: String, name: String) -> Unit = { _, _ -> }) {
    val c = NodeTalkTheme.extendedColors
    val api = NodeTalkApp.instance.apiClient
    val me = NodeTalkApp.instance.preferencesManager.userId.orEmpty()
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
        NTTextField(query, { query = it }, placeholder = "Search by username")
        results.forEach { u ->
            val already = relationships.any { it.toUserId == u.id && (it.type == "friend" || it.type == "requested") }
            PersonRow(u.id, u.username, u.avatarId) {
                if (already) Text("Added", color = c.textMuted, fontSize = 13.sp)
                else Action("Add", NTPrimary) { act(u.id, "request", "Friend request sent to ${u.username}.") }
            }
        }
        message?.let { Text(it, color = c.statusOnline, fontSize = 13.sp) }
        error?.let { ErrorBanner(it) }

        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).border(1.dp, c.border, RoundedCornerShape(6.dp)).background(c.card).padding(3.dp)) {
            FriendsTab.entries.forEach { t ->
                val count = when (t) { FriendsTab.Pending -> incoming.size; else -> 0 }
                Box(
                    Modifier.weight(1f).height(34.dp).clip(RoundedCornerShape(4.dp))
                        .background(if (t == tab) NTPrimary else Color.Transparent).clickable { tab = t },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        t.label + if (count > 0) " ($count)" else "",
                        color = if (t == tab) Color.White else c.textMuted, fontSize = 13.sp, fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        val friends = relationships.filter { it.type == "friend" }
        val sent = relationships.filter { it.type == "requested" }
        val blocked = relationships.filter { it.type == "blocked" }
        when (tab) {
            FriendsTab.Friends -> {
                if (friends.isEmpty()) Empty("No friends yet. Search above to add someone.")
                friends.forEach { f ->
                    val name = f.user?.username ?: "Unknown"
                    PersonRow(f.toUserId, name, f.user?.avatarId) {
                        Action("Message", NTPrimary) { startDm(f.toUserId, name) }
                        Action("Whisper", NTPrimary) { onStartWhisper(f.toUserId, name) }
                        Action("Remove", NTDestructive) { act(f.toUserId, "remove") }
                    }
                }
            }
            FriendsTab.Pending -> {
                if (incoming.isEmpty()) Empty("No pending requests.")
                incoming.forEach { r ->
                    PersonRow(r.fromUserId, r.user?.username ?: "Unknown", r.user?.avatarId) {
                        Action("Accept", NTPrimary) { act(r.fromUserId, "accept") }
                        Action("Decline", NTDestructive) { act(r.fromUserId, "decline") }
                    }
                }
            }
            FriendsTab.Sent -> {
                if (sent.isEmpty()) Empty("No outgoing requests.")
                sent.forEach { r ->
                    PersonRow(r.toUserId, r.user?.username ?: "Unknown", r.user?.avatarId) {
                        Action("Cancel", NTDestructive) { act(r.toUserId, "cancel") }
                    }
                }
            }
            FriendsTab.Blocked -> {
                if (blocked.isEmpty()) Empty("You haven't blocked anyone.")
                blocked.forEach { r ->
                    PersonRow(r.toUserId, r.user?.username ?: "Unknown", r.user?.avatarId) {
                        Action("Unblock", NTPrimary) { act(r.toUserId, "unblock") }
                    }
                }
            }
        }
    }
}

@Composable
private fun Empty(text: String) {
    Text(text, color = NodeTalkTheme.extendedColors.textMuted, fontSize = 14.sp, modifier = Modifier.padding(vertical = 12.dp))
}

@Composable
private fun PersonRow(userId: String, name: String, avatarId: String? = null, actions: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        UserAvatar(userId, size = 36.dp, avatarId = avatarId)
        Spacer(Modifier.width(12.dp))
        Text(name, color = NodeTalkTheme.extendedColors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        actions()
    }
}

@Composable
private fun Action(label: String, color: Color, onClick: () -> Unit) {
    Text(
        label, color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 8.dp)
    )
}
