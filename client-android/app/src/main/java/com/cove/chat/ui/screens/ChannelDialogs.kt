package com.cove.chat.ui.screens

import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.CoveConfirmDialog
import com.cove.chat.ui.components.FormField
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.CoveSwitchRow
import com.cove.chat.ui.components.SectionHeader
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.Spacing
import com.cove.chat.ui.components.I18nToast
import android.content.ClipData
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.ChannelAvatar
import com.cove.chat.data.remote.AvatarCache
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material.icons.outlined.Add
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.rememberLauncherForActivityResult
import android.content.Intent
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.cove.chat.CoveApp
import com.cove.chat.data.model.Channel
import com.cove.chat.data.model.UpdateChannelRequest
import com.cove.chat.data.model.UserSummary
import com.cove.chat.ui.components.ErrorBanner
import com.cove.chat.ui.components.FieldLabel
import com.cove.chat.ui.components.InitialsAvatar
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveTextField
import com.cove.chat.ui.components.SectionDivider
import com.cove.chat.ui.components.StatusDot
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveTheme
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
fun MembersDialog(channel: Channel, me: String, onDismiss: () -> Unit, onChanged: () -> Unit = {}, onViewProfile: (String) -> Unit = {}) {
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
                                onClick = if (id != me) ({ menuFor = id }) else null,
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
                                DropdownMenuItem(text = { Text("View profile") }, onClick = { menuFor = null; onViewProfile(id) })
                                if (manageable && myRole >= ROLE_OWNER) {
                                    DropdownMenuItem(
                                        text = { Text(if (role >= ROLE_ADMIN) "Remove admin" else "Make admin") },
                                        onClick = {
                                            menuFor = null
                                            scope.launch { report(api.setMemberRole(channel.id, id, if (role >= ROLE_ADMIN) 0 else ROLE_ADMIN)) }
                                        }
                                    )
                                }
                                if (manageable) DropdownMenuItem(
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
 * Channel settings and info, like the web group settings: photo, name, description, privacy, invite link (copy and
 * share), multi-select member adding with the reasons for anyone who could not be added, creation date and your
 * role, delete (owner) or leave. Members see the same dialog read-only. Role gates mirror the backend
 * (`Channel Admin` / `Channel Owner`); the server remains the authority.
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
    val app = CoveApp.instance
    val api = app.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val myRole = channel.memberRoles[me] ?: channel.userRole
    val isAdmin = myRole >= ROLE_ADMIN

    var name by remember { mutableStateOf(channel.name) }
    var description by remember { mutableStateOf(channel.description) }
    var isPrivate by remember { mutableStateOf(channel.isPrivate) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    val selected = remember { mutableStateMapOf<String, UserSummary>() }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var avatarBusy by remember { mutableStateOf(false) }
    var showFriendPicker by remember { mutableStateOf(false) }
    var confirmRegenerate by remember { mutableStateOf(false) }

    fun toast(msg: String) = I18nToast.make(context, msg, Toast.LENGTH_SHORT).show()

    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        api.searchUsers(query.trim()).onSuccess { r -> results = r.filter { it.id !in channel.members } }
    }

    fun setAvatar(fileId: String) {
        avatarBusy = true
        scope.launch {
            api.updateChannel(channel.id, UpdateChannelRequest(avatarId = fileId)).fold(
                onSuccess = { channel.avatarId?.takeIf { it.isNotBlank() }?.let(AvatarCache::invalidate); error = null; onChanged() },
                onFailure = { error = it.message }
            )
            avatarBusy = false
        }
    }
    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        avatarBusy = true
        scope.launch {
            val uploaded = withContext(Dispatchers.IO) {
                runCatching {
                    val src = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Couldn't read the image.")
                    if (src.size > MAX_GROUP_PHOTO_BYTES) error("Image must be smaller than 2 MB.")
                    val bytes = squareAvatarBytes(src) ?: error("That file isn't a supported image.")
                    api.uploadAvatar(bytes, "image/webp").getOrThrow()
                }
            }
            uploaded.onSuccess { setAvatar(it.id) }.onFailure { error = it.message; avatarBusy = false }
        }
    }

    val inviteUrl = channel.inviteLink?.takeIf { it.isNotBlank() }?.let { "${app.preferencesManager.serverUrl}/join/$it" }
    val created = remember(channel.createdAt) {
        runCatching {
            java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
                .withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(channel.createdAt))
        }.getOrNull()
    }
    val roleLabel = when { myRole >= ROLE_OWNER -> "Owner"; myRole >= ROLE_ADMIN -> "Admin"; else -> "Member" }

    CoveDialog(onDismiss, title = if (isAdmin) "Channel Settings" else "Channel info") {
        Column(
            Modifier.heightIn(max = 600.dp).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(contentAlignment = Alignment.Center) {
                    ChannelAvatar(channel.id, channel.name, channel.avatarId, size = 64.dp)
                    if (avatarBusy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(channel.name, color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold, maxLines = 1)
                    Text(
                        (if (channel.isPrivate) "Private" else "Public") + " · ${channel.members.size} members",
                        color = c.textMuted, fontSize = CoveType.label.fontSize
                    )
                    Text(
                        listOfNotNull(created?.let { "Created $it" }, "You are $roleLabel").joinToString(" · "),
                        color = c.textMuted.copy(alpha = 0.8f), fontSize = CoveType.caption.fontSize
                    )
                }
            }
            if (isAdmin) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    CoveButton("Change photo", { pickAvatar.launch("image/*") }, variant = ButtonVariant.Secondary, size = ButtonSize.Sm, enabled = !avatarBusy)
                    if (!channel.avatarId.isNullOrBlank()) CoveButton("Remove photo", { setAvatar("") }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, enabled = !avatarBusy)
                }
            }
            error?.let { ErrorBanner(it) }
            notice?.let { Text(it, color = c.textMuted, fontSize = CoveType.label.fontSize) }

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

            if (inviteUrl != null) {
                FieldLabel("Invite link")
                Column(Modifier.fillMaxWidth().clip(CoveShapes.md).background(c.popover).padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    androidx.compose.material3.Text(inviteUrl, color = c.textPrimary, fontSize = CoveType.label.fontSize, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        CoveButton("Copy", variant = ButtonVariant.Secondary, size = ButtonSize.Sm, onClick = {
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            cm.setPrimaryClip(ClipData.newPlainText("Invite link", inviteUrl))
                            toast("Invite link copied")
                        })
                        CoveButton("Share", variant = ButtonVariant.Secondary, size = ButtonSize.Sm, onClick = {
                            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, InviteLinks.shareText(channel.name, inviteUrl))
                            context.startActivity(Intent.createChooser(send, null))
                        })
                        CoveButton("Send to friends", variant = ButtonVariant.Secondary, size = ButtonSize.Sm, onClick = { showFriendPicker = true })
                    }
                    if (isAdmin) CoveButton("New link", variant = ButtonVariant.Ghost, size = ButtonSize.Sm, onClick = { confirmRegenerate = true })
                }
            }

            if (isAdmin) {
                FieldLabel("Add members")
                CoveTextField(query, { query = it }, placeholder = "Search by username")
                selected.values.forEach { u ->
                    CoveListRow(
                        title = u.username,
                        contentPadding = PaddingValues(vertical = Spacing.xs),
                        leading = { UserAvatar(u.id, size = 28.dp, avatarId = u.avatarId) },
                        trailing = { CoveIconButton(Icons.Outlined.Close, "Remove", { selected.remove(u.id) }, size = 32.dp, iconSize = 16.dp) }
                    )
                }
                results.filter { it.id !in selected }.forEach { u ->
                    CoveListRow(
                        title = u.username,
                        contentPadding = PaddingValues(vertical = Spacing.xs),
                        onClick = { selected[u.id] = u },
                        leading = { UserAvatar(u.id, size = 32.dp, avatarId = u.avatarId) },
                        trailing = { Icon(Icons.Outlined.Add, "Select", tint = c.textMuted, modifier = Modifier.size(20.dp)) }
                    )
                }
                if (selected.isNotEmpty()) {
                    CoveButton("Add ${selected.size} ${if (selected.size == 1) "member" else "members"}", modifier = Modifier.fillMaxWidth(), loading = adding, onClick = {
                        adding = true
                        val chosen = selected.values.toList()
                        scope.launch {
                            api.addMembers(channel.id, chosen.map { it.id }).fold(
                                onSuccess = { r ->
                                    error = null
                                    selected.clear(); query = ""
                                    notice = r.skipped.takeIf { it.isNotEmpty() }?.joinToString("\n") { s ->
                                        "Couldn't add ${chosen.firstOrNull { it.id == s.userId }?.username ?: "a user"}: ${s.reason}"
                                    }
                                    onChanged()
                                },
                                onFailure = { error = it.message }
                            )
                            adding = false
                        }
                    })
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

    if (showFriendPicker && inviteUrl != null) FriendPickerDialog(InviteLinks.shareText(channel.name, inviteUrl)) { showFriendPicker = false }
    if (confirmRegenerate) {
        CoveConfirmDialog(
            title = "Create a new invite link",
            message = "The current link stops working immediately. People who already joined stay in the channel.",
            confirmLabel = "Create new link",
            onDismiss = { confirmRegenerate = false },
            onConfirm = {
                confirmRegenerate = false
                scope.launch {
                    api.regenerateInvite(channel.id).fold(onSuccess = { error = null; toast("New invite link created"); onChanged() }, onFailure = { error = it.message })
                }
            }
        )
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

/** Largest group photo accepted before cropping (same cap as the web settings). */
private const val MAX_GROUP_PHOTO_BYTES = 2 * 1024 * 1024
