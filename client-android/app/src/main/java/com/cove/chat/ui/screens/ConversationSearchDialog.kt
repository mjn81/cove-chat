package com.cove.chat.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.CircleShape
import com.cove.chat.ui.theme.CoveExtendedColors
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.DialogSize
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.CoveBadge
import com.cove.chat.ui.components.CoveChip
import com.cove.chat.ui.components.EmptyState
import com.cove.chat.ui.components.SectionHeader
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
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
import com.cove.chat.CoveApp
import com.cove.chat.data.model.Channel
import com.cove.chat.data.model.CreateChannelRequest
import com.cove.chat.data.model.UserSummary
import com.cove.chat.data.model.ExploreChannel
import com.cove.chat.ui.components.InitialsAvatar
import com.cove.chat.ui.components.SectionDivider
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.components.I18nToast
import android.widget.Toast
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.ui.platform.LocalContext
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal enum class SearchFilter { All, Dms, Channels, Explore, Bots }

/**
 * Conversation search + public channel explorer, the mobile layout of client-web `ConversationSearchDialog`
 * (design-reference/21..23): search box, All / Direct Messages / Channels / Explore Public filters with counts, and
 * grouped results (Direct Messages, People you can start a chat with, Channels, Public Channels with a Join button).
 * Starting a direct message happens here; the "+" button only creates channels.
 */
@Composable
fun ConversationSearchDialog(
    channels: List<Channel>,
    me: String?,
    onDismiss: () -> Unit,
    onOpenChannel: (Channel) -> Unit,
    onJoined: (channelId: String) -> Unit,
    onCreateNew: () -> Unit
) {
    val c = CoveTheme.extendedColors
    val api = CoveApp.instance.apiClient
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val focus = remember { FocusRequester() }

    var query by remember { mutableStateOf("") }
    var debounced by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(SearchFilter.All) }
    var explore by remember { mutableStateOf<List<ExploreChannel>>(emptyList()) }
    var exploring by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf<String?>(null) }
    var found by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var startingDm by remember { mutableStateOf<String?>(null) }
    var dmError by remember { mutableStateOf<String?>(null) }
    // Public bots for the Bots tab (only on servers with the Bot API).
    var botsSupported by remember { mutableStateOf(false) }
    var bots by remember { mutableStateOf<List<com.cove.chat.bots.Bot>>(emptyList()) }
    var loadingBots by remember { mutableStateOf(false) }
    var startingBot by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(Unit) { botsSupported = com.cove.chat.data.remote.ApiStandard.supportsBots(api.getVersion().getOrNull()?.capabilities) }
    LaunchedEffect(debounced, filter, botsSupported) {
        if (!botsSupported || filter != SearchFilter.Bots) return@LaunchedEffect
        loadingBots = true
        api.discoverBots(debounced).onSuccess { bots = it.items }
        loadingBots = false
    }
    LaunchedEffect(query) { delay(300); debounced = query.trim() }
    // Same as the web hook: public channels are fetched for the (debounced) query and shown unless already joined.
    LaunchedEffect(debounced) {
        exploring = true
        api.exploreChannels(debounced).onSuccess { explore = it }
        exploring = false
    }
    // People matching the query, for starting a new direct message.
    LaunchedEffect(debounced) {
        if (debounced.isBlank()) { found = emptyList(); return@LaunchedEffect }
        api.searchUsers(debounced).onSuccess { found = it }
    }

    val q = query.trim().lowercase()
    val filtered = channels.filter { ch ->
        if (filter == SearchFilter.Dms && !ch.isDirectMessage) return@filter false
        if (filter == SearchFilter.Channels && ch.isDirectMessage) return@filter false
        if (filter == SearchFilter.Explore || filter == SearchFilter.Bots) return@filter false
        q.isEmpty() || ch.displayName(me).lowercase().contains(q) || ch.description.lowercase().contains(q)
    }
    val dms = filtered.filter { it.isDirectMessage }
    val groups = filtered.filter { !it.isDirectMessage }
    val joinedIds = channels.map { it.id }.toSet()
    val publicExplore = if (filter == SearchFilter.Dms) emptyList() else explore.filter { it.id !in joinedIds }
    val showExplore = (filter == SearchFilter.All && q.isNotEmpty() || filter == SearchFilter.Explore) && (publicExplore.isNotEmpty() || exploring)
    val showDms = (filter == SearchFilter.All || filter == SearchFilter.Dms) && dms.isNotEmpty()
    val showGroups = (filter == SearchFilter.All || filter == SearchFilter.Channels) && groups.isNotEmpty()
    val dmPeers = channels.filter { it.isDirectMessage }.flatMap { it.members }.toSet()
    val people = if (showsPeople(filter, q)) peopleToStart(found, me.orEmpty(), dmPeers) else emptyList()
    val showPeople = people.isNotEmpty()
    val empty = !showDms && !showPeople && !showGroups && publicExplore.let { !(showExplore && it.isNotEmpty()) }

    fun startDm(user: UserSummary) {
        if (startingDm != null) return
        startingDm = user.id
        dmError = null
        scope.launch {
            // The backend returns the existing DM when there is one, so this also reopens a chat.
            api.createChannel(CreateChannelRequest(name = "", members = listOf(me.orEmpty(), user.id), isPrivate = true)).fold(
                onSuccess = { onOpenChannel(it) },
                onFailure = { dmError = it.message; startingDm = null }
            )
        }
    }

    /** Starts a chat with a bot (the server opens or finds the DM and tells the bot) and opens it. */
    fun startBot(bot: com.cove.chat.bots.Bot) {
        if (startingBot != null) return
        startingBot = bot.id
        scope.launch {
            api.startBot(bot.id).fold(
                onSuccess = { res ->
                    if (!res.delivered) I18nToast.make(context, "${bot.username} is offline right now. It will answer when it is back.", Toast.LENGTH_SHORT).show()
                    api.getChannels().onSuccess { list -> list.firstOrNull { it.id == res.channelId }?.let(onOpenChannel) }
                },
                onFailure = { dmError = it.message }
            )
            startingBot = null
        }
    }

    fun join(ch: ExploreChannel) {
        if (joining != null) return
        joining = ch.id
        scope.launch {
            // Servers no longer put an invite link in explore results: a public channel is joined by its id. Older
            // servers still send the link, which keeps working.
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
            if (botsSupported) CoveChip("Bots", filter == SearchFilter.Bots, { filter = SearchFilter.Bots }, icon = Icons.Outlined.SmartToy)
        }
        SectionDivider()

        if (filter == SearchFilter.Bots) {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(Spacing.sm), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                item { SectionHeader("Public bots", loading = loadingBots) }
                if (bots.isEmpty() && !loadingBots) item { Text("No public bots found.", color = c.textMuted, style = CoveType.label, modifier = Modifier.padding(Spacing.lg)) }
                items(bots, key = { "bot-" + it.id }) { b ->
                    CoveListRow(
                        title = b.username,
                        subtitle = (b.description.ifBlank { "No description" }) + "\n" + (if (b.commandCount == 1) "1 command" else "${b.commandCount} commands"),
                        titleBadge = { com.cove.chat.ui.components.BotBadge() },
                        compact = true, onClick = { startBot(b) },
                        contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm),
                        leading = { UserAvatar(b.id, size = 36.dp, avatarId = b.avatarId) },
                        trailing = { CoveButton("Message", { startBot(b) }, size = ButtonSize.Sm, loading = startingBot == b.id) }
                    )
                }
                dmError?.let { err -> item { Text(err, color = MaterialTheme.colorScheme.error, fontSize = CoveType.caption.fontSize, modifier = Modifier.padding(Spacing.md)) } }
            }
        } else if (empty && !(filter == SearchFilter.Explore && exploring)) {
            EmptyState(
                title = "No conversations found",
                message = if (query.trim().isNotEmpty()) "No matches found for \"${query.trim()}\". Try another query or explore public channels." else "You have no conversations in this category yet.",
                actions = {
                    CoveButton("New Channel", onCreateNew, size = ButtonSize.Sm)
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
                if (showPeople) {
                    item { SectionHeader("Start a conversation") }
                    items(people, key = { "user-" + it.id }) { u ->
                        CoveListRow(
                            title = u.username, subtitle = u.status.replaceFirstChar { it.uppercase() },
                            compact = true, onClick = { startDm(u) },
                            contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm),
                            leading = { UserAvatar(u.id, size = 36.dp, avatarId = u.avatarId) },
                            trailing = {
                                if (startingDm == u.id) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                                else Text("Message", color = c.textMuted, fontSize = CoveType.caption.fontSize)
                            }
                        )
                    }
                    dmError?.let { err -> item { Text(err, color = MaterialTheme.colorScheme.error, fontSize = CoveType.caption.fontSize, modifier = Modifier.padding(Spacing.md)) } }
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
