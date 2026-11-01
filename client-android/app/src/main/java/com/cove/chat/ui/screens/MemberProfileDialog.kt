package com.cove.chat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.TheaterComedy
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.CreateChannelRequest
import com.cove.chat.data.model.Relationship
import com.cove.chat.data.model.UserSummary
import com.cove.chat.ui.components.CoveConfirmDialog
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.DialogSize
import com.cove.chat.ui.components.ErrorBanner
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.launch

/** A `#RRGGBB` banner colour from the profile, or null when it is missing or malformed. */
private fun parseBanner(hex: String?): Color? {
    val h = hex?.removePrefix("#") ?: return null
    if (h.length != 6) return null
    val rgb = h.toLongOrNull(16) ?: return null
    return Color(0xFF000000 or rgb)
}

/** One quick action: a round icon over a short label, like the row under a Telegram profile photo. */
@Composable
private fun ActionTile(icon: ImageVector, label: String, enabled: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = CoveTheme.extendedColors
    val tint = if (enabled) MaterialTheme.colorScheme.primary else c.textMuted.copy(alpha = 0.5f)
    Column(
        modifier.clip(CoveShapes.lg).clickable(enabled = enabled, onClick = onClick).padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = tint, modifier = Modifier.size(22.dp))
        }
        Text(label, color = if (enabled) c.textPrimary else c.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

/** A full-width list row with a leading icon, used for the friend and block actions. */
@Composable
private fun ProfileRow(icon: ImageVector, label: String, tint: Color, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, color = tint, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * Profile card for a member, opened by tapping an @mention or the header of a direct message (web `UserProfileModal`),
 * laid out like Telegram's: a banner with the avatar, name and status, a row of round quick actions (message, voice
 * call, video call, whisper), then rows for the friend action that fits the relationship and Block.
 *
 * @param canContact false disables calls and whisper, for the automated system accounts that cannot reply.
 * @param onOpenChat receives the DM id and name.
 * @param onCall starts a call in the DM with that id (`withVideo` picks voice or video).
 * @param onEditProfile for your own profile: opens settings (photos, name, status).
 * @param onStartWhisper starts a Whisper (the end-to-end encrypted chat that leaves nothing on the server) with the user.
 */
@Composable
fun MemberProfileDialog(
    userId: String,
    username: String,
    avatarId: String?,
    onDismiss: () -> Unit,
    onOpenChat: (channelId: String, name: String) -> Unit,
    onCall: (channelId: String, name: String, withVideo: Boolean) -> Unit = { _, _, _ -> },
    onStartWhisper: (userId: String, name: String) -> Unit = { _, _ -> },
    canContact: Boolean = true,
    /** When this is your own profile, shows an "Edit profile" row that opens settings. */
    onEditProfile: (() -> Unit)? = null
) {
    val c = CoveTheme.extendedColors
    val app = CoveApp.instance
    val me = app.preferencesManager.userId.orEmpty()
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf<UserSummary?>(null) }
    var outgoing by remember { mutableStateOf<List<Relationship>>(emptyList()) }
    var incoming by remember { mutableStateOf<List<Relationship>>(emptyList()) }
    var tick by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmBlock by remember { mutableStateOf(false) }
    var showGallery by remember { mutableStateOf(false) }
    val isSelf = userId == me

    // There is no per-user endpoint: the user search returns the same summary the web profile shows.
    LaunchedEffect(userId) {
        if (isSelf) {
            // Your own record comes from /me: user search is for finding other people.
            app.apiClient.getMe().onSuccess { u ->
                profile = UserSummary(
                    id = u.id, username = u.username, status = u.status, avatarId = u.avatarId, avatarIds = u.avatarIds,
                    customMsg = u.customMsg, bannerColor = u.bannerColor
                )
            }
        } else {
            app.apiClient.searchUsers(username).onSuccess { list -> profile = list.firstOrNull { it.id == userId } }
        }
    }
    LaunchedEffect(userId, tick) {
        if (isSelf) return@LaunchedEffect
        app.apiClient.getRelationships().onSuccess { outgoing = it }
        app.apiClient.getIncomingRequests().onSuccess { incoming = it }
    }
    val relation = relationStateOf(userId, outgoing, incoming)

    fun act(action: String) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            app.apiClient.relationshipAction(userId, action).fold(
                onSuccess = { tick++ },
                onFailure = { error = it.message }
            )
            busy = false
        }
    }

    /** Opens (or creates) the DM, then hands its id to [then]. The backend returns the existing DM when there is one. */
    fun withDm(then: (channelId: String) -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            app.apiClient.createChannel(CreateChannelRequest(name = "", members = listOf(me, userId), isPrivate = true)).fold(
                onSuccess = { then(it.id) },
                onFailure = { error = it.message; busy = false }
            )
        }
    }

    val primary = MaterialTheme.colorScheme.primary
    val danger = MaterialTheme.colorScheme.error
    val banner = parseBanner(profile?.bannerColor) ?: primary
    // Every profile photo, main one first; tapping the avatar opens them full screen.
    val photos = galleryOf(profile?.avatarId ?: avatarId, profile?.avatarIds)

    CoveDialog(onDismiss = onDismiss, size = DialogSize.Sm, showClose = false) {
        Column(Modifier.fillMaxWidth()) {
            // Banner with the avatar half over its lower edge.
            Box(Modifier.fillMaxWidth().height(132.dp)) {
                Box(Modifier.fillMaxWidth().height(84.dp).background(banner.copy(alpha = 0.85f)))
                Box(
                    Modifier.align(Alignment.BottomCenter).size(96.dp).clip(CircleShape).background(c.popover).padding(4.dp)
                        .clickable(enabled = photos.isNotEmpty()) { showGallery = true },
                    contentAlignment = Alignment.Center
                ) { UserAvatar(userId, size = 88.dp, avatarId = profile?.avatarId ?: avatarId) }
                Box(
                    Modifier.align(Alignment.TopEnd).padding(8.dp).size(36.dp).clip(CircleShape).clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Outlined.Close, "Close", tint = Color.White, modifier = Modifier.size(20.dp)) }
            }

            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(username, color = c.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                profile?.let { p ->
                    val online = p.status == "online"
                    Text(p.status.replaceFirstChar { it.uppercase() }, color = if (online) c.statusOnline else c.textMuted, fontSize = 13.sp)
                    if (!p.customMsg.isNullOrBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(p.customMsg, color = c.textPrimary, fontSize = 14.sp, textAlign = TextAlign.Center)
                    }
                }
            }

            error?.let { Box(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) { ErrorBanner(it) } }

            if (!isSelf) {
                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    ActionTile(Icons.Outlined.ChatBubbleOutline, "Message", !busy, Modifier.weight(1f)) { withDm { onOpenChat(it, username) } }
                    val reachable = canContact && relation != RelationState.Blocked && !busy
                    ActionTile(Icons.Outlined.Phone, "Call", reachable, Modifier.weight(1f)) { withDm { onCall(it, username, false) } }
                    ActionTile(Icons.Outlined.Videocam, "Video", reachable, Modifier.weight(1f)) { withDm { onCall(it, username, true) } }
                    ActionTile(Icons.Outlined.TheaterComedy, "Whisper", reachable, Modifier.weight(1f)) { onStartWhisper(userId, username) }
                }
                if (busy) Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                }

                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
                when (relation) {
                    RelationState.None -> ProfileRow(Icons.Outlined.PersonAdd, "Add friend", primary, !busy) { act("request") }
                    RelationState.Requested -> ProfileRow(Icons.Outlined.Close, "Cancel friend request", c.textMuted, !busy) { act("cancel") }
                    RelationState.Incoming -> {
                        ProfileRow(Icons.Outlined.HowToReg, "Accept friend request", primary, !busy) { act("accept") }
                        ProfileRow(Icons.Outlined.Close, "Decline request", c.textMuted, !busy) { act("decline") }
                    }
                    RelationState.Friend -> ProfileRow(Icons.Outlined.PersonRemove, "Remove friend", c.textPrimary, !busy) { act("remove") }
                    RelationState.Blocked -> ProfileRow(Icons.Outlined.Block, "Unblock", primary, !busy) { act("unblock") }
                }
                if (relation != RelationState.Blocked) ProfileRow(Icons.Outlined.Block, "Block user", danger, !busy) { confirmBlock = true }
                Spacer(Modifier.height(8.dp))
            } else {
                if (onEditProfile != null) {
                    Spacer(Modifier.height(16.dp))
                    Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
                    ProfileRow(Icons.Outlined.Edit, "Edit profile", primary, true, onEditProfile)
                }
                Spacer(Modifier.height(if (onEditProfile != null) 8.dp else 20.dp))
            }
        }
    }

    if (showGallery) AvatarGalleryViewer(photos) { showGallery = false }

    if (confirmBlock) {
        CoveConfirmDialog(
            title = "Block $username?",
            message = "They won't be able to message or call you, and any friendship with them ends.",
            confirmLabel = "Block",
            destructive = true,
            onConfirm = { confirmBlock = false; act("block") },
            onDismiss = { confirmBlock = false }
        )
    }
}
