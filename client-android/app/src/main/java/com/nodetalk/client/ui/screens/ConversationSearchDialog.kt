package com.nodetalk.client.ui.screens

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
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.ExploreChannel
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
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
    val c = NodeTalkTheme.extendedColors
    val api = NodeTalkApp.instance.apiClient
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

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().clickable(onClick = onDismiss), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier
                    .padding(top = 72.dp, start = 8.dp, end = 8.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.card)
                    .border(1.dp, c.border, RoundedCornerShape(16.dp))
                    .clickable(enabled = false) {}
            ) {
                // Search input
                Row(
                    Modifier.fillMaxWidth().background(c.card).padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.Search, null, tint = c.textMuted, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) {
                            Text("Search conversations, direct messages, or public channels...", color = c.textMuted.copy(alpha = 0.7f), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        BasicTextField(
                            value = query, onValueChange = { query = it }, singleLine = true,
                            textStyle = TextStyle(color = c.textPrimary, fontSize = 15.sp),
                            cursorBrush = SolidColor(NTPrimary),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus)
                        )
                    }
                    if (query.isNotEmpty()) {
                        Icon(Icons.Outlined.Close, "Clear", tint = c.textMuted, modifier = Modifier.padding(start = 8.dp).size(18.dp).clickable { query = "" })
                    }
                }
                SectionDivider()

                // Filter chips
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip("All", null, channels.size, filter == SearchFilter.All) { filter = SearchFilter.All }
                    FilterChip("Direct Messages", Icons.Outlined.Person, channels.count { it.isDirectMessage }, filter == SearchFilter.Dms) { filter = SearchFilter.Dms }
                    FilterChip("Channels", Icons.Outlined.Tag, channels.count { !it.isDirectMessage }, filter == SearchFilter.Channels) { filter = SearchFilter.Channels }
                    FilterChip("Explore Public", Icons.Outlined.Explore, null, filter == SearchFilter.Explore) { filter = SearchFilter.Explore }
                }
                SectionDivider()

                if (empty && !(filter == SearchFilter.Explore && exploring)) {
                    EmptyState(query.trim(), onCreateNew)
                } else {
                    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(horizontal = 8.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        if (showDms) {
                            item { SectionTitle("Direct Messages") }
                            items(dms, key = { "dm-" + it.id }) { ch ->
                                val other = ch.members.firstOrNull { it != me } ?: ch.members.firstOrNull() ?: ch.id
                                val status = ch.memberStatuses[other] ?: "offline"
                                ResultRow(
                                    leading = {
                                        Box {
                                            UserAvatar(other, size = 36.dp, avatarId = ch.memberAvatars[other])
                                            Box(Modifier.align(Alignment.BottomEnd).size(12.dp).clip(RoundedCornerShape(50)).background(c.card).padding(1.5.dp).clip(RoundedCornerShape(50)).background(statusColor(status)))
                                        }
                                    },
                                    title = ch.displayName(me), titleIcon = null, subtitle = status.replaceFirstChar { it.uppercase() },
                                    unread = ch.unreadCount, onClick = { onOpenChannel(ch) }, trailing = null
                                )
                            }
                        }
                        if (showGroups) {
                            item { SectionTitle("Channels") }
                            items(groups, key = { "ch-" + it.id }) { ch ->
                                ResultRow(
                                    leading = { InitialsAvatar(ch.id, ch.name, size = 36.dp) },
                                    title = ch.name, titleIcon = Icons.Outlined.Tag, titleIconTint = c.textMuted,
                                    subtitle = ch.description.ifBlank { "${ch.members.size} members" },
                                    unread = ch.unreadCount, onClick = { onOpenChannel(ch) }, trailing = null
                                )
                            }
                        }
                        if (showExplore) {
                            item { SectionTitle("Public Channels", loading = exploring) }
                            items(publicExplore, key = { "ex-" + it.id }) { ch ->
                                ResultRow(
                                    leading = { InitialsAvatar(ch.id, ch.name, size = 36.dp) },
                                    title = ch.name, titleIcon = Icons.Outlined.Explore, titleIconTint = Color(0xFF818CF8),
                                    subtitle = ch.description.ifBlank { "${ch.memberCount} members" },
                                    unread = 0, onClick = { join(ch) },
                                    trailing = {
                                        Box(
                                            Modifier.height28().clip(RoundedCornerShape(8.dp)).background(NTPrimary).clickable { join(ch) }.padding(horizontal = 10.dp),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            if (joining == ch.id) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(12.dp))
                                            else Text("Join", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                        }
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

private fun Modifier.height28() = this.then(Modifier.heightIn(min = 28.dp, max = 28.dp))

private fun statusColor(status: String): Color = when (status) {
    "online" -> Color(0xFF22C55E)
    "away" -> Color(0xFFEAB308)
    "dnd" -> Color(0xFFEF4444)
    else -> Color(0xFF71717A)
}

@Composable
private fun FilterChip(label: String, icon: ImageVector?, count: Int?, selected: Boolean, onClick: () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).background(if (selected) NTPrimary else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val tint = if (selected) Color.White else c.textMuted
        icon?.let { Icon(it, null, tint = tint, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, color = tint, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        count?.let { Spacer(Modifier.width(6.dp)); androidx.compose.material3.Text(it.toString(), color = tint.copy(alpha = 0.75f), fontSize = 10.sp) }
    }
}

@Composable
private fun SectionTitle(text: String, loading: Boolean = false) {
    val c = NodeTalkTheme.extendedColors
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), color = c.textMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp, modifier = Modifier.weight(1f))
        if (loading) CircularProgressIndicator(color = NTPrimary, strokeWidth = 1.5.dp, modifier = Modifier.size(12.dp))
    }
}

@Composable
private fun ResultRow(
    leading: @Composable () -> Unit,
    title: String,
    titleIcon: ImageVector?,
    subtitle: String,
    unread: Int,
    onClick: () -> Unit,
    trailing: (@Composable () -> Unit)?,
    titleIconTint: Color = Color.Unspecified
) {
    val c = NodeTalkTheme.extendedColors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        leading()
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                titleIcon?.let { Icon(it, null, tint = titleIconTint, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp)) }
                Text(title, color = c.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(subtitle, color = c.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (unread > 0) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.heightIn(min = 18.dp).widthIn18().clip(RoundedCornerShape(5.dp)).background(Color(0xFFE05638)).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                androidx.compose.material3.Text(unread.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
        trailing?.let { Spacer(Modifier.width(8.dp)); it() }
    }
}

private fun Modifier.widthIn18() = this.then(Modifier.widthIn(min = 18.dp))

@Composable
private fun EmptyState(query: String, onCreateNew: (dmTab: Boolean) -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)).background(c.accent.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Search, null, tint = c.textMuted, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.size(12.dp))
        Text("No conversations found", color = c.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.size(4.dp))
        Text(
            if (query.isNotEmpty()) "No matches found for \"$query\". Try another query or explore public channels." else "You have no conversations in this category yet.",
            color = c.textMuted, fontSize = 12.sp, textAlign = TextAlign.Center
        )
        Spacer(Modifier.size(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.clip(RoundedCornerShape(8.dp)).background(c.accent).clickable { onCreateNew(true) }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Person, null, tint = c.textPrimary, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
                Text("New DM", color = c.textPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
            Row(Modifier.clip(RoundedCornerShape(8.dp)).background(NTPrimary).clickable { onCreateNew(false) }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Add, null, tint = Color.White, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
                Text("New Channel", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}
