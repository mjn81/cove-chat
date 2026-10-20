package com.nodetalk.client.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.UpdateChannelRequest
import com.nodetalk.client.data.model.UserSummary
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FieldLabel
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.NTPrimaryButton
import com.nodetalk.client.ui.components.NTTextField
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.StatusDot
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val ROLE_ADMIN = 10
private const val ROLE_OWNER = 20

@Composable
private fun PanelDialog(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(c.chatCanvas)
                .border(1.dp, c.border, RoundedCornerShape(8.dp))
        ) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = c.textPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.Close, "Close", tint = c.textMuted, modifier = Modifier.size(20.dp).clickable(onClick = onDismiss))
            }
            SectionDivider()
            content()
        }
    }
}

/**
 * Members panel grouped by role like the web right sidebar (reference: design-reference/10-members.png).
 * Admins/owners can tap a member for role / removal actions (same rules the backend enforces:
 * only owners change roles, nobody removes an equal-or-higher role).
 */
@Composable
fun MembersDialog(channel: Channel, me: String, onDismiss: () -> Unit, onChanged: () -> Unit = {}) {
    val c = NodeTalkTheme.extendedColors
    val api = NodeTalkApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val myRole = channel.memberRoles[me] ?: channel.userRole
    var menuFor by remember { mutableStateOf<String?>(null) }

    val groups = listOf(20 to "OWNER", 10 to "ADMIN", 0 to "MEMBER").map { (role, label) ->
        Triple(role, label, channel.members.filter { (channel.memberRoles[it] ?: 0) == role })
    }.filter { it.third.isNotEmpty() }

    fun report(r: Result<Unit>) {
        r.onFailure { Toast.makeText(context, it.message ?: "Action failed.", Toast.LENGTH_SHORT).show() }
        r.onSuccess { onChanged() }
    }

    PanelDialog("Members", onDismiss) {
        LazyColumn(Modifier.heightIn(max = 480.dp).padding(vertical = 8.dp)) {
            groups.forEach { (_, label, ids) ->
                item {
                    Text(
                        "$label — ${ids.size}",
                        color = c.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )
                }
                ids.forEach { id ->
                    item(key = id) {
                        val role = channel.memberRoles[id] ?: 0
                        val manageable = id != me && myRole >= ROLE_ADMIN && role < myRole
                        Box {
                            Row(
                                Modifier.fillMaxWidth().clickable(enabled = manageable) { menuFor = id }.padding(horizontal = 16.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box {
                                    UserAvatar(id, size = 32.dp, avatarId = channel.memberAvatars[id])
                                    Box(Modifier.align(Alignment.BottomEnd)) {
                                        StatusDot(online = channel.memberStatuses[id] == "online", size = 8.dp, ring = c.chatCanvas)
                                    }
                                }
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    (channel.memberNames[id] ?: "Unknown") + if (id == me) " (you)" else "",
                                    color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium
                                )
                            }
                            DropdownMenu(expanded = menuFor == id, onDismissRequest = { menuFor = null }) {
                                if (myRole >= ROLE_OWNER) {
                                    DropdownMenuItem(
                                        text = { Text(if (role >= ROLE_ADMIN) "Remove admin" else "Make admin") },
                                        onClick = {
                                            menuFor = null
                                            scope.launch { report(api.setMemberRole(channel.id, id, if (role >= ROLE_ADMIN) 0 else ROLE_ADMIN)) }
                                        }
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text("Remove from channel", color = NTDestructive) },
                                    onClick = {
                                        menuFor = null
                                        scope.launch { report(api.leaveChannel(channel.id, id)) }
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Channel settings: info, invite link, add members, edit (admins), delete (owner) and leave.
 * Role gates mirror the backend (`Channel Admin` / `Channel Owner`); the server remains the authority.
 */
@Composable
fun ChannelSettingsDialog(
    channel: Channel,
    me: String,
    onDismiss: () -> Unit,
    onLeave: () -> Unit,
    onChanged: () -> Unit = {},
    onDeleted: () -> Unit = {}
) {
    val c = NodeTalkTheme.extendedColors
    val api = NodeTalkApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val myRole = channel.memberRoles[me] ?: channel.userRole
    val isAdmin = myRole >= ROLE_ADMIN

    var name by remember { mutableStateOf(channel.name) }
    var description by remember { mutableStateOf(channel.description) }
    var isPrivate by remember { mutableStateOf(channel.isPrivate) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        api.searchUsers(query.trim()).onSuccess { r -> results = r.filter { it.id !in channel.members } }
    }

    PanelDialog("Channel Settings", onDismiss) {
        Column(
            Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialsAvatar(channel.id, channel.name, size = 48.dp)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(channel.name, color = c.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Text(
                        (if (channel.isPrivate) "Private" else "Public") + " · ${channel.members.size} members",
                        color = c.textMuted, fontSize = 13.sp
                    )
                }
            }
            error?.let { ErrorBanner(it) }

            if (isAdmin) {
                FieldLabel("Channel name")
                NTTextField(name, { name = it })
                FieldLabel("Description")
                NTTextField(description, { description = it }, placeholder = "What is this channel about?")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Private channel", color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text("Hidden from Explore.", color = c.textMuted, fontSize = 12.sp)
                    }
                    Switch(
                        checked = isPrivate, onCheckedChange = { isPrivate = it },
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = NTPrimary, checkedThumbColor = Color.White,
                            uncheckedTrackColor = c.accent, uncheckedThumbColor = Color.White,
                            uncheckedBorderColor = Color.Transparent, checkedBorderColor = Color.Transparent
                        )
                    )
                }
                NTPrimaryButton("Save changes", loading = saving, enabled = name.isNotBlank(), onClick = {
                    saving = true
                    scope.launch {
                        api.updateChannel(channel.id, UpdateChannelRequest(name.trim(), description.trim(), isPrivate)).fold(
                            onSuccess = { error = null; onChanged() },
                            onFailure = { error = it.message }
                        )
                        saving = false
                    }
                })
            } else if (channel.description.isNotBlank()) {
                Text(channel.description, color = c.textMuted, fontSize = 14.sp)
            }

            if (!channel.inviteLink.isNullOrBlank()) {
                FieldLabel("Invite link")
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(c.popover).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(channel.inviteLink, color = c.textPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1)
                    Text(
                        "Copy", color = NTPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable {
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            cm.setPrimaryClip(ClipData.newPlainText("Invite link", channel.inviteLink))
                            Toast.makeText(context, "Invite link copied", Toast.LENGTH_SHORT).show()
                        }.padding(start = 12.dp)
                    )
                }
            }

            if (isAdmin) {
                FieldLabel("Add members")
                NTTextField(query, { query = it }, placeholder = "Search by username")
                results.forEach { u ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        UserAvatar(u.id, size = 32.dp, avatarId = u.avatarId)
                        Spacer(Modifier.width(12.dp))
                        Text(u.username, color = c.textPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
                        Text(
                            "Add", color = NTPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                            modifier = Modifier.clickable {
                                scope.launch {
                                    api.addMembers(channel.id, listOf(u.id)).fold(
                                        onSuccess = { error = null; query = ""; onChanged() },
                                        onFailure = { error = it.message }
                                    )
                                }
                            }.padding(8.dp)
                        )
                    }
                }
            }

            SectionDivider()
            if (myRole >= ROLE_OWNER) {
                if (confirmDelete) {
                    Text("Delete this channel for everyone? This can't be undone.", color = c.textMuted, fontSize = 13.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("Cancel", color = c.textMuted, fontWeight = FontWeight.Medium, modifier = Modifier.clickable { confirmDelete = false }.padding(vertical = 8.dp))
                        Text("Yes, delete", color = NTDestructive, fontWeight = FontWeight.Bold, modifier = Modifier.clickable {
                            scope.launch {
                                api.deleteChannel(channel.id).fold(onSuccess = { onDeleted() }, onFailure = { error = it.message; confirmDelete = false })
                            }
                        }.padding(vertical = 8.dp))
                    }
                } else {
                    Text("Delete Channel", color = NTDestructive, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.fillMaxWidth().clickable { confirmDelete = true }.padding(vertical = 8.dp))
                }
            } else {
                Text("Leave Channel", color = NTDestructive, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onLeave).padding(vertical = 8.dp))
            }
        }
    }
}
