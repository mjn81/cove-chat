package com.nodetalk.client.ui.screens

import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.components.ButtonVariant
import com.nodetalk.client.ui.components.ButtonSize
import com.nodetalk.client.ui.components.CoveDialog
import com.nodetalk.client.ui.components.CoveConfirmDialog
import com.nodetalk.client.ui.components.FormField
import com.nodetalk.client.ui.components.CoveListRow
import com.nodetalk.client.ui.components.CoveSwitchRow
import com.nodetalk.client.ui.components.SectionHeader
import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.Spacing
import com.nodetalk.client.ui.components.I18nToast
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.nodetalk.client.CoveApp
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.UpdateChannelRequest
import com.nodetalk.client.data.model.UserSummary
import com.nodetalk.client.ui.components.ErrorBanner
import com.nodetalk.client.ui.components.FieldLabel
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.CoveTextField
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.StatusDot
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val ROLE_ADMIN = 10
private const val ROLE_OWNER = 20

/**
 * Members panel grouped by role like the web right sidebar (reference: design-reference/10-members.png).
 * Admins/owners can tap a member for role / removal actions (same rules the backend enforces:
 * only owners change roles, nobody removes an equal-or-higher role).
 */
@Composable
fun MembersDialog(channel: Channel, me: String, onDismiss: () -> Unit, onChanged: () -> Unit = {}) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val myRole = channel.memberRoles[me] ?: channel.userRole
    var menuFor by remember { mutableStateOf<String?>(null) }

    val groups = listOf(20 to "OWNER", 10 to "ADMIN", 0 to "MEMBER").map { (role, label) ->
        Triple(role, label, channel.members.filter { (channel.memberRoles[it] ?: 0) == role })
    }.filter { it.third.isNotEmpty() }

    fun report(r: Result<Unit>) {
        r.onFailure { I18nToast.make(context, it.message ?: "Action failed.", Toast.LENGTH_SHORT).show() }
        r.onSuccess { onChanged() }
    }

    CoveDialog(onDismiss, title = "Members") {
        LazyColumn(Modifier.heightIn(max = 480.dp).padding(vertical = 8.dp)) {
            groups.forEach { (_, label, ids) ->
                item {
                    SectionHeader("$label — ${ids.size}")
                }
                ids.forEach { id ->
                    item(key = id) {
                        val role = channel.memberRoles[id] ?: 0
                        val manageable = id != me && myRole >= ROLE_ADMIN && role < myRole
                        Box {
                            CoveListRow(
                                title = (channel.memberNames[id] ?: "Unknown") + if (id == me) " (you)" else "",
                                onClick = if (manageable) ({ menuFor = id }) else null,
                                contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = 6.dp),
                                leading = {
                                    Box {
                                        UserAvatar(id, size = 32.dp, avatarId = channel.memberAvatars[id])
                                        Box(Modifier.align(Alignment.BottomEnd)) {
                                            StatusDot(online = channel.memberStatuses[id] == "online", size = 8.dp, ring = c.chatCanvas)
                                        }
                                    }
                                }
                            )
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
                                    text = { Text("Remove from channel", color = MaterialTheme.colorScheme.error) },
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
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
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

    CoveDialog(onDismiss, title = "Channel Settings") {
        Column(
            Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialsAvatar(channel.id, channel.name, size = 48.dp)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(channel.name, color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold)
                    Text(
                        (if (channel.isPrivate) "Private" else "Public") + " · ${channel.members.size} members",
                        color = c.textMuted, fontSize = CoveType.label.fontSize
                    )
                }
            }
            error?.let { ErrorBanner(it) }

            if (isAdmin) {
                FormField("Channel name") { CoveTextField(name, { name = it }) }
                FormField("Description") { CoveTextField(description, { description = it }, placeholder = "What is this channel about?") }
                CoveSwitchRow("Private channel", isPrivate, caption = "Hidden from Explore.") { isPrivate = it }
                CoveButton("Save changes", modifier = Modifier.fillMaxWidth(), size = ButtonSize.Lg, loading = saving, enabled = name.isNotBlank(), onClick = {
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
                Text(channel.description, color = c.textMuted, fontSize = CoveType.label.fontSize)
            }

            if (!channel.inviteLink.isNullOrBlank()) {
                FieldLabel("Invite link")
                Row(
                    Modifier.fillMaxWidth().clip(CoveShapes.md).background(c.popover).padding(Spacing.md),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(channel.inviteLink, color = c.textPrimary, fontSize = CoveType.label.fontSize, modifier = Modifier.weight(1f), maxLines = 1)
                    CoveButton("Copy", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, onClick = {
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("Invite link", channel.inviteLink))
                        I18nToast.make(context, "Invite link copied", Toast.LENGTH_SHORT).show()
                    })
                }
            }

            if (isAdmin) {
                FieldLabel("Add members")
                CoveTextField(query, { query = it }, placeholder = "Search by username")
                results.forEach { u ->
                    CoveListRow(
                        title = u.username,
                        contentPadding = PaddingValues(vertical = Spacing.xs),
                        leading = { UserAvatar(u.id, size = 32.dp, avatarId = u.avatarId) },
                        trailing = {
                            CoveButton("Add", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, onClick = {
                                scope.launch {
                                    api.addMembers(channel.id, listOf(u.id)).fold(
                                        onSuccess = { error = null; query = ""; onChanged() },
                                        onFailure = { error = it.message }
                                    )
                                }
                            })
                        }
                    )
                }
            }

            SectionDivider()
            if (myRole >= ROLE_OWNER) {
                CoveListRow("Delete Channel", titleColor = MaterialTheme.colorScheme.error, contentPadding = PaddingValues(vertical = Spacing.sm), onClick = { confirmDelete = true })
            } else {
                CoveListRow("Leave Channel", titleColor = MaterialTheme.colorScheme.error, contentPadding = PaddingValues(vertical = Spacing.sm), onClick = onLeave)
            }
        }
    }

    if (confirmDelete) {
        CoveConfirmDialog(
            title = "Delete Channel",
            message = "Delete this channel for everyone? This can't be undone.",
            confirmLabel = "Yes, delete",
            destructive = true,
            onDismiss = { confirmDelete = false },
            onConfirm = {
                scope.launch {
                    api.deleteChannel(channel.id).fold(onSuccess = { onDeleted() }, onFailure = { error = it.message; confirmDelete = false })
                }
            }
        )
    }
}
