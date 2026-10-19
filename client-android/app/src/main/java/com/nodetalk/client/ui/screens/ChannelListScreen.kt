package com.nodetalk.client.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.ViewList
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.crypto.CryptoManager
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.NTTextField
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.StatusDot
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme

private enum class ListTab(val icon: ImageVector) {
    All(Icons.Outlined.ViewList),
    Direct(Icons.Outlined.ChatBubbleOutline),
    Channels(Icons.Outlined.Tag)
}

/** Last-message preview text, decrypted client-side (same wording rules as the web sidebar). */
private fun previewFor(ch: Channel, me: String?): String {
    val cipher = ch.lastMessageCiphertext ?: return ""
    val nonce = ch.lastMessageNonce ?: return ""
    val type = ch.lastMessageType ?: "text"
    val body = if (type == "text") CryptoManager.decryptMessage(ch.id, cipher, nonce) else "Sent a $type"
    val sender = ch.lastMessageSenderId
    val prefix = when {
        sender == null -> ""
        sender == me -> "You: "
        !ch.isDirectMessage -> (ch.memberNames[sender]?.let { "$it: " } ?: "")
        else -> ""
    }
    return prefix + body
}

/**
 * Conversation list. Layout follows design-reference/11-conversation-list.png: header, three filter tabs
 * (all / direct messages / channels), search + new conversation, list, and the signed-in user footer.
 */
@Composable
fun ChannelListScreen(
    onChannelSelected: (channelId: String, channelName: String) -> Unit,
    onOpenSettings: () -> Unit
) {
    val app = NodeTalkApp.instance
    val api = app.apiClient
    val ws = app.webSocketManager
    val prefs = app.preferencesManager
    val c = NodeTalkTheme.extendedColors
    val me = prefs.userId

    var channels by remember { mutableStateOf<List<Channel>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf(ListTab.All) }
    var query by remember { mutableStateOf("") }
    var showNew by remember { mutableStateOf(false) }
    var version by remember { mutableStateOf("") }
    val connected by ws.connectionState.collectAsState(initial = false)
    val keyVersion by CryptoManager.keyVersion.collectAsState()
    var refreshTick by remember { mutableStateOf(0) }

    LaunchedEffect(refreshTick) {
        api.getChannels().onSuccess { channels = it }
        loaded = true
    }
    LaunchedEffect(Unit) { api.getVersion().onSuccess { version = it.version } }
    // New messages and membership changes alter ordering/previews, so just reload the (small) list.
    LaunchedEffect(Unit) { ws.messageFlow.collect { refreshTick++ } }
    LaunchedEffect(Unit) { ws.channelsChangedFlow.collect { refreshTick++ } }

    val visible = remember(channels, tab, query) {
        channels
            .filter {
                when (tab) {
                    ListTab.All -> true
                    ListTab.Direct -> it.isDirectMessage
                    ListTab.Channels -> !it.isDirectMessage
                }
            }
            .filter { query.isBlank() || it.displayName(me).contains(query, ignoreCase = true) }
            .sortedByDescending { it.lastMessageAt.ifBlank { it.createdAt } }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.card)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        // Header
        Row(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("NodeTalk Client", color = c.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text(version, color = c.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (connected) c.statusOnline else c.statusOffline)
            )
        }
        SectionDivider()

        // Filter tabs
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp)) {
            ListTab.entries.forEach { t ->
                val active = t == tab
                Box(
                    Modifier
                        .weight(1f)
                        .height(36.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (active) NTPrimary.copy(alpha = 0.2f) else androidx.compose.ui.graphics.Color.Transparent)
                        .clickable { tab = t },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(t.icon, contentDescription = t.name, tint = if (active) NTPrimary else c.textMuted, modifier = Modifier.size(20.dp))
                }
            }
        }
        SectionDivider()

        // Search + new conversation
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            NTTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = "Search...",
                modifier = Modifier.weight(1f),
                height = 32.dp,
                leading = {
                    Icon(Icons.Outlined.Search, null, tint = c.textMuted, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                }
            )
            Box(
                Modifier.size(40.dp).clickable { showNew = true },
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Outlined.Add, contentDescription = "New conversation", tint = c.textMuted)
            }
        }

        // List
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (visible.isEmpty() && loaded) {
                Text(
                    "No conversations. Click + to start!",
                    color = c.textMuted,
                    fontSize = 14.sp,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 24.dp)
                )
            }
            LazyColumn(Modifier.fillMaxSize()) {
                items(visible, key = { it.id }) { ch ->
                    val name = ch.displayName(me)
                    // keyVersion in the key re-computes previews once a channel key arrives
                    val preview = remember(ch, keyVersion) { previewFor(ch, me) }
                    ConversationRow(ch, name, preview) { onChannelSelected(ch.id, name) }
                }
            }
        }

        // Signed-in user footer
        SectionDivider()
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box {
                UserAvatar(me ?: "?", size = 32.dp)
                Box(Modifier.align(Alignment.BottomEnd)) { StatusDot(online = connected, size = 8.dp, ring = c.card) }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(prefs.username ?: "", color = c.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                Text(if (connected) "Online" else "Offline", color = c.textMuted, fontSize = 12.sp)
            }
            Box(Modifier.size(40.dp).clickable(onClick = onOpenSettings), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Settings, contentDescription = "Settings", tint = c.textMuted)
            }
        }
    }

    if (showNew) {
        NewConversationDialog(
            onDismiss = { showNew = false },
            onJoined = { showNew = false; refreshTick++ },
            onCreated = { ch ->
                showNew = false
                refreshTick++
                onChannelSelected(ch.id, ch.displayName(me))
            }
        )
    }
}

@Composable
private fun ConversationRow(ch: Channel, name: String, preview: String, onClick: () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (ch.isDirectMessage) {
            val other = ch.members.firstOrNull { it != NodeTalkApp.instance.preferencesManager.userId } ?: ch.id
            UserAvatar(other, size = 40.dp)
        } else {
            InitialsAvatar(ch.id, name, size = 40.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                name,
                color = if (ch.unreadCount > 0) c.textPrimary else c.textMuted,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (preview.isNotBlank()) {
                Text(preview, color = c.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (ch.unreadCount > 0) {
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.clip(RoundedCornerShape(10.dp)).background(NTPrimary).padding(horizontal = 6.dp, vertical = 1.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(ch.unreadCount.toString(), color = androidx.compose.ui.graphics.Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
