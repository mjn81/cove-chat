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
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.CreateChannelRequest
import com.nodetalk.client.data.model.ExploreChannel
import com.nodetalk.client.data.model.UserSummary
import com.nodetalk.client.ui.components.AppLanguage
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FieldLabel
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.NTTextField
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * "New Conversation" dialog with Direct Message / Channel tabs
 * (reference: design-reference/05..07). DMs reuse the web rule: an unnamed private channel
 * whose members are [me, target]; the backend de-duplicates existing DMs.
 */
@Composable
fun NewConversationDialog(onDismiss: () -> Unit, onCreated: (Channel) -> Unit, onJoined: () -> Unit = {}) {
    val c = NodeTalkTheme.extendedColors
    val app = NodeTalkApp.instance
    val api = app.apiClient
    val me = app.preferencesManager.userId.orEmpty()
    val scope = rememberCoroutineScope()

    var mode by remember { mutableStateOf(1) } // 0 = DM, 1 = channel, 2 = explore
    val dmTab = mode == 0
    val exploreTab = mode == 2
    var explore by remember { mutableStateOf<List<ExploreChannel>>(emptyList()) }
    var exploreQuery by remember { mutableStateOf("") }
    var inviteLink by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isPrivate by remember { mutableStateOf(true) }
    var userQuery by remember { mutableStateOf("") }
    var users by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Debounced user search (one request per pause in typing, never per keystroke)
    LaunchedEffect(userQuery, dmTab) {
        if (!dmTab || userQuery.isBlank()) {
            users = emptyList()
            return@LaunchedEffect
        }
        delay(300)
        api.searchUsers(userQuery.trim()).onSuccess { res -> users = res.filter { it.id != me } }
    }

    LaunchedEffect(exploreQuery, exploreTab) {
        if (!exploreTab) return@LaunchedEffect
        delay(300)
        api.exploreChannels(exploreQuery.trim()).onSuccess { explore = it }
    }

    fun join(link: String) {
        if (busy || link.isBlank()) return
        busy = true
        error = null
        scope.launch {
            api.joinChannel(link.trim().substringAfterLast('/')).fold(
                onSuccess = { onJoined() },
                onFailure = { error = it.message; busy = false }
            )
        }
    }

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

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(c.chatCanvas)
                .border(1.dp, c.border, RoundedCornerShape(8.dp))
        ) {
            Box(Modifier.fillMaxWidth().padding(top = 20.dp)) {
                Text(
                    "New Conversation",
                    color = c.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.Center)
                )
                Icon(
                    Icons.Outlined.Close, "Close", tint = c.textMuted,
                    modifier = Modifier.align(Alignment.TopEnd).padding(end = 16.dp).size(20.dp).clickable(onClick = onDismiss)
                )
            }

            Column(Modifier.padding(horizontal = 16.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Segmented tabs
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .border(1.dp, c.border, RoundedCornerShape(8.dp))
                        .background(c.card)
                        .padding(3.dp)
                ) {
                    SegmentButton("DM", Icons.Outlined.ChatBubbleOutline, selected = mode == 0, Modifier.weight(1f)) { mode = 0 }
                    SegmentButton("Channel", Icons.Outlined.Tag, selected = mode == 1, Modifier.weight(1f)) { mode = 1 }
                    SegmentButton("Explore", Icons.Outlined.Explore, selected = mode == 2, Modifier.weight(1f)) { mode = 2 }
                }

                error?.let { ErrorBanner(it) }

                if (dmTab) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FieldLabel("Find a user")
                        NTTextField(userQuery, { userQuery = it }, placeholder = "Search by username")
                        LazyColumn(Modifier.heightIn(max = 240.dp)) {
                            items(users, key = { it.id }) { u ->
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { create(CreateChannelRequest(name = "", members = listOf(me, u.id), isPrivate = true)) }
                                        .padding(vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    UserAvatar(u.id, size = 32.dp, avatarId = u.avatarId)
                                    Spacer(Modifier.width(12.dp))
                                    Text(u.username, color = c.textPrimary, fontSize = 15.sp)
                                }
                            }
                        }
                    }
                } else if (exploreTab) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FieldLabel("Join with invite link")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            NTTextField(inviteLink, { inviteLink = it }, placeholder = "Paste an invite link", modifier = Modifier.weight(1f))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Join", color = NTPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                                modifier = Modifier.clickable(enabled = inviteLink.isNotBlank() && !busy) { join(inviteLink) }.padding(8.dp)
                            )
                        }
                        FieldLabel("Public channels")
                        NTTextField(exploreQuery, { exploreQuery = it }, placeholder = "Search channels")
                        LazyColumn(Modifier.heightIn(max = 240.dp)) {
                            items(explore, key = { it.id }) { ch ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    InitialsAvatar(ch.id, ch.name, size = 36.dp)
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(ch.name, color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                                        Text("${ch.memberCount} members", color = c.textMuted, fontSize = 12.sp)
                                    }
                                    Text(
                                        "Join", color = NTPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                                        modifier = Modifier.clickable(enabled = !busy) { join(ch.inviteLink) }.padding(8.dp)
                                    )
                                }
                            }
                        }
                        if (explore.isEmpty()) Text("No public channels found.", color = c.textMuted, fontSize = 13.sp)
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        InitialsAvatar(id = name.ifBlank { "new" }, name = name, size = 64.dp)
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FieldLabel("Channel Name")
                            NTTextField(name, { name = it }, height = 40.dp)
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            androidx.compose.ui.text.buildAnnotatedString {
                                append(AppLanguage.translate("DESCRIPTION "))
                                pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.Normal))
                                append(AppLanguage.translate("(optional)"))
                            },
                            color = c.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold
                        )
                        NTTextField(description, { description = it }, placeholder = "What is this channel about?")
                    }
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .border(1.dp, c.border, RoundedCornerShape(8.dp))
                            .padding(12.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Lock, null, tint = NTDestructive, modifier = Modifier.size(22.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Private Channel", color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                Text("Only invited members can find and join.", color = c.textMuted, fontSize = 13.sp)
                            }
                            Switch(
                                checked = isPrivate,
                                onCheckedChange = { isPrivate = it },
                                colors = SwitchDefaults.colors(
                                    checkedTrackColor = NTPrimary, checkedThumbColor = Color.White,
                                    uncheckedTrackColor = c.accent, uncheckedThumbColor = Color.White,
                                    uncheckedBorderColor = Color.Transparent, checkedBorderColor = Color.Transparent
                                )
                            )
                        }
                        if (isPrivate) {
                            Spacer(Modifier.height(10.dp))
                            Text(
                                "Note: This channel will not appear in the discoverable \"Explore\" list.",
                                color = c.textMuted, fontSize = 12.sp, fontStyle = FontStyle.Italic,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(c.popover)
                                    .padding(10.dp)
                            )
                        }
                    }
                }
            }

            SectionDivider()
            Row(
                Modifier.fillMaxWidth().background(c.card).padding(12.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Cancel", color = c.textMuted, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable(onClick = onDismiss).padding(horizontal = 20.dp, vertical = 10.dp)
                )
                if (mode == 1) {
                    val enabled = name.isNotBlank() && !busy
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (enabled) NTPrimary else NTPrimary.copy(alpha = 0.5f))
                            .clickable(enabled = enabled) {
                                create(CreateChannelRequest(name = name.trim(), description = description.trim(), members = listOf(me), isPrivate = isPrivate))
                            }
                            .padding(horizontal = 20.dp, vertical = 10.dp)
                    ) {
                        Text("Create", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
                    }
                }
            }
        }
    }
}

@Composable
private fun SegmentButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit
) {
    val c = NodeTalkTheme.extendedColors
    Row(
        modifier
            .height(36.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) NTPrimary else Color.Transparent)
            .clickable(onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = if (selected) Color.White else c.textMuted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, color = if (selected) Color.White else c.textMuted, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}
