package com.nodetalk.client.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.CircleShape
import com.nodetalk.client.ui.theme.CoveExtendedColors
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.ButtonVariant
import com.nodetalk.client.ui.components.ButtonSize
import com.nodetalk.client.ui.components.CoveDialog
import com.nodetalk.client.ui.components.DialogSize
import com.nodetalk.client.ui.components.CoveListRow
import com.nodetalk.client.ui.components.CoveBadge
import com.nodetalk.client.ui.components.CoveChip
import com.nodetalk.client.ui.components.EmptyState
import com.nodetalk.client.ui.components.SectionHeader
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Spacing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.nodetalk.client.CoveApp
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.ExploreChannel
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SearchFilter { All, Dms, Channels, Explore }

/**
 * Conversation search + public channel explorer, the mobile layout of client-web `ConversationSearchDialog`
 * (design-reference/21..23): search box, All / Direct Messages / Channels / Explore Public filters with counts, and
 * grouped results (Direct Messages, Channels, Public Channels with a Join button).
 */
@Composable
fun ConversationSearchDialog(
    channels: List<Channel>,
    me: String?,
    onDismiss: () -> Unit,
    onOpenChannel: (Channel) -> Unit,
    onJoined: (channelId: String) -> Unit,
    onCreateNew: (dmTab: Boolean) -> Unit
) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }

    var query by remember { mutableStateOf("") }
    var debounced by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(SearchFilter.All) }
    var explore by remember { mutableStateOf<List<ExploreChannel>>(emptyList()) }
    var exploring by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query) { delay(300); debounced = query.trim() }
    // Same as the web hook: public channels are fetched for the (debounced) query and shown unless already joined.
    LaunchedEffect(debounced) {
        exploring = true
        api.exploreChannels(debounced).onSuccess { explore = it }
        exploring = false
    }

    val q = query.trim().lowercase()
    val filtered = channels.filter { ch ->
        if (filter == SearchFilter.Dms && !ch.isDirectMessage) return@filter false
        if (filter == SearchFilter.Channels && ch.isDirectMessage) return@filter false
        if (filter == SearchFilter.Explore) return@filter false
        q.isEmpty() || ch.displayName(me).lowercase().contains(q) || ch.description.lowercase().contains(q)
    }
    val dms = filtered.filter { it.isDirectMessage }
    val groups = filtered.filter { !it.isDirectMessage }
    val joinedIds = channels.map { it.id }.toSet()
    val publicExplore = if (filter == SearchFilter.Dms) emptyList() else explore.filter { it.id !in joinedIds }
    val showExplore = (filter == SearchFilter.All && q.isNotEmpty() || filter == SearchFilter.Explore) && (publicExplore.isNotEmpty() || exploring)
    val showDms = (filter == SearchFilter.All || filter == SearchFilter.Dms) && dms.isNotEmpty()
    val showGroups = (filter == SearchFilter.All || filter == SearchFilter.Channels) && groups.isNotEmpty()
    val empty = !showDms && !showGroups && publicExplore.let { !(showExplore && it.isNotEmpty()) }

    fun join(ch: ExploreChannel) {
        if (joining != null) return
        joining = ch.id
        scope.launch {
            api.joinChannel(ch.inviteLink.ifBlank { ch.id }).onSuccess { onJoined(ch.id) }
            joining = null
        }
    }

    CoveDialog(onDismiss = onDismiss, size = DialogSize.Lg, alignTop = true, showClose = false, container = c.card) {
        // Search input
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.lg, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.Search, null, tint = c.textMuted, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(Spacing.md))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text("Search conversations, direct messages, or public channels...", color = c.textMuted.copy(alpha = 0.7f), style = CoveType.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                BasicTextField(
                    value = query, onValueChange = { query = it }, singleLine = true,
                    textStyle = TextStyle(color = c.textPrimary, fontSize = CoveType.body.fontSize),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus)
                )
            }
            if (query.isNotEmpty()) {
                Icon(Icons.Outlined.Close, "Clear", tint = c.textMuted, modifier = Modifier.padding(start = Spacing.sm).size(18.dp).clickable { query = "" })
            }
        }
        SectionDivider()

        // Filter chips
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.lg, vertical = Spacing.sm), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            CoveChip("All", filter == SearchFilter.All, { filter = SearchFilter.All }, count = channels.size)
            CoveChip("Direct Messages", filter == SearchFilter.Dms, { filter = SearchFilter.Dms }, icon = Icons.Outlined.Person, count = channels.count { it.isDirectMessage })
            CoveChip("Channels", filter == SearchFilter.Channels, { filter = SearchFilter.Channels }, icon = Icons.Outlined.Tag, count = channels.count { !it.isDirectMessage })
            CoveChip("Explore Public", filter == SearchFilter.Explore, { filter = SearchFilter.Explore }, icon = Icons.Outlined.Explore)
        }
        SectionDivider()

        if (empty && !(filter == SearchFilter.Explore && exploring)) {
            EmptyState(
                title = "No conversations found",
                message = if (query.trim().isNotEmpty()) "No matches found for \"${query.trim()}\". Try another query or explore public channels." else "You have no conversations in this category yet.",
                actions = {
                    CoveButton("New DM", { onCreateNew(true) }, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                    CoveButton("New Channel", { onCreateNew(false) }, size = ButtonSize.Sm)
                }
            )
        } else {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(Spacing.sm), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (showDms) {
                    item { SectionHeader("Direct Messages") }
                    items(dms, key = { "dm-" + it.id }) { ch ->
                        val other = ch.members.firstOrNull { it != me } ?: ch.members.firstOrNull() ?: ch.id
                        val status = ch.memberStatuses[other] ?: "offline"
                        CoveListRow(
                            title = ch.displayName(me), subtitle = status.replaceFirstChar { it.uppercase() },
                            compact = true, onClick = { onOpenChannel(ch) },
                            contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm),
                            leading = {
                                Box {
                                    UserAvatar(other, size = 36.dp, avatarId = ch.memberAvatars[other])
                                    Box(Modifier.align(Alignment.BottomEnd).size(12.dp).clip(CircleShape).background(c.card).padding(1.5.dp).clip(CircleShape).background(statusColor(status, c)))
                                }
                            },
                            trailing = if (ch.unreadCount > 0) ({ CoveBadge(ch.unreadCount) }) else null
                        )
                    }
                }
                if (showGroups) {
                    item { SectionHeader("Channels") }
                    items(groups, key = { "ch-" + it.id }) { ch ->
                        CoveListRow(
                            title = ch.name, subtitle = ch.description.ifBlank { "${ch.members.size} members" },
                            titleIcon = Icons.Outlined.Tag, titleIconTint = c.textMuted,
                            compact = true, onClick = { onOpenChannel(ch) },
                            contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm),
                            leading = { InitialsAvatar(ch.id, ch.name, size = 36.dp) },
                            trailing = if (ch.unreadCount > 0) ({ CoveBadge(ch.unreadCount) }) else null
                        )
                    }
                }
                if (showExplore) {
                    item { SectionHeader("Public Channels", loading = exploring) }
                    items(publicExplore, key = { "ex-" + it.id }) { ch ->
                        CoveListRow(
                            title = ch.name, subtitle = ch.description.ifBlank { "${ch.memberCount} members" },
                            titleIcon = Icons.Outlined.Explore, titleIconTint = MaterialTheme.colorScheme.primary,
                            compact = true, onClick = { join(ch) },
                            contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm),
                            leading = { InitialsAvatar(ch.id, ch.name, size = 36.dp) },
                            trailing = { CoveButton("Join", { join(ch) }, size = ButtonSize.Sm, loading = joining == ch.id) }
                        )
                    }
                }
            }
        }
    }
}

private fun statusColor(status: String, c: CoveExtendedColors): Color = when (status) {
    "online" -> c.statusOnline
    "away" -> c.statusIdle
    "dnd" -> c.statusDnd
    else -> c.statusOffline
}
