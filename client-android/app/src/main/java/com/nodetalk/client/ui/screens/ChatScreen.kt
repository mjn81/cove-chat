package com.nodetalk.client.ui.screens

import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveType
import androidx.compose.material3.MaterialTheme
import com.nodetalk.client.ui.components.CoveIconButton
import com.nodetalk.client.ui.components.I18nToast
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import com.nodetalk.client.ui.components.chatBackgroundPattern
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.Icon
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.MessageText
import com.nodetalk.client.ui.components.mirrorInRtl
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.nodetalk.client.CoveApp
import com.nodetalk.client.crypto.CryptoManager
import com.nodetalk.client.data.model.Channel
import com.nodetalk.client.data.model.Message
import com.nodetalk.client.data.model.fileMeta
import com.nodetalk.client.data.model.previewText
import com.nodetalk.client.notify.ActiveChat
import com.nodetalk.client.ui.components.InitialsAvatar
import com.nodetalk.client.ui.components.CoveTextField
import com.nodetalk.client.ui.components.SectionDivider
import com.nodetalk.client.ui.components.UserAvatar
import kotlinx.coroutines.delay
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.Spacing
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val TimeFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("hh:mm a", Locale.ENGLISH)
private val DateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", Locale.ENGLISH)
private val DateFormatThisYear: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.ENGLISH)

private fun parseInstant(s: String): Instant? = runCatching { Instant.parse(s) }.getOrNull()

private fun Message.localDate(): LocalDate? = parseInstant(sentAt)?.atZone(ZoneId.systemDefault())?.toLocalDate()

private fun Message.timeLabel(): String =
    parseInstant(sentAt)?.atZone(ZoneId.systemDefault())?.format(TimeFormat) ?: ""

private fun dayLabel(d: LocalDate): String {
    val today = LocalDate.now()
    return when (d) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> d.format(if (d.year == today.year) DateFormatThisYear else DateFormat)
    }
}

/** Plain text of a message, decrypted client-side; non-text kinds show a placeholder. */
private fun bodyOf(m: Message): String =
    if (m.type == "voice" || m.type == "video") "Sent a ${m.type} message (play it on the web or desktop client)" else m.previewText()

/**
 * Chat view. Layout follows design-reference/09-chat-messages.png: 48dp top bar, welcome header,
 * day separators, grouped message rows and the rounded input bar. Messages are fetched newest-first
 * and rendered in a reversed list so the newest message is anchored at the bottom.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    channelId: String,
    channelName: String,
    onBack: () -> Unit,
    onStartCall: (withVideo: Boolean) -> Unit,
    onStartWhisper: (peerId: String, peerName: String) -> Unit = { _, _ -> },
    onOpenChat: (channelId: String, name: String) -> Unit = { _, _ -> }
) {
    val app = CoveApp.instance
    val api = app.apiClient
    val ws = app.webSocketManager
    val me = app.preferencesManager.userId.orEmpty()
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val listState = rememberLazyListState()
    val keyVersion by CryptoManager.keyVersion.collectAsState()

    var channel by remember { mutableStateOf<Channel?>(null) }
    // Newest-first, exactly the order the API returns.
    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
    var hasMore by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<Message?>(null) }
    var editing by remember { mutableStateOf<Message?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var showMembers by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var profileMention by remember { mutableStateOf<MentionMember?>(null) }
    val mentionMembers = remember(channel) {
        channel?.let { ch -> ch.memberNames.map { (id, name) -> MentionMember(id, name, ch.memberAvatars[id]) } }.orEmpty()
    }
    val pageSize = 50

    fun toast(msg: String) = I18nToast.make(context, msg, Toast.LENGTH_SHORT).show()

    // Opening a chat marks it read and silences its notification; the chat counts as "active" while shown.
    DisposableEffect(channelId) {
        ActiveChat.channelId = channelId
        app.notificationHelper.clear(channelId)
        onDispose { if (ActiveChat.channelId == channelId) ActiveChat.channelId = null }
    }
    LaunchedEffect(channelId) { ws.connectionState.collect { if (it) ws.sendReadReceipt(channelId) } }

    LaunchedEffect(channelId) {
        api.getChannels().onSuccess { list -> channel = list.firstOrNull { it.id == channelId } }
        api.getMessages(channelId, pageSize).onSuccess {
            messages = it
            hasMore = it.size >= pageSize
        }
    }
    LaunchedEffect(channelId) { ws.channelsChangedFlow.collect { api.getChannels().onSuccess { l -> channel = l.firstOrNull { it.id == channelId } } } }
    LaunchedEffect(channelId) {
        ws.messageFlow.collect { m ->
            if (m.channelId == channelId && messages.none { it.id == m.id }) {
                messages = listOf(m) + messages
                ws.sendReadReceipt(channelId)
                if (listState.firstVisibleItemIndex <= 1) listState.animateScrollToItem(0)
            }
        }
    }
    LaunchedEffect(channelId) {
        ws.messageUpdateFlow.collect { u ->
            if (u.channelId == channelId) messages = messages.map { if (it.id == u.id) u else it }
        }
    }
    LaunchedEffect(channelId) {
        ws.messageDeleteFlow.collect { d ->
            if (d.channelId == channelId) messages = messages.filterNot { it.id == d.messageId }
        }
    }

    // Older page when the user scrolls to the top (end of a reversed list).
    val nearTop by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount > 0 && last >= info.totalItemsCount - 3
        }
    }
    LaunchedEffect(nearTop, messages.size) {
        if (nearTop && hasMore && !loadingMore && messages.isNotEmpty()) {
            loadingMore = true
            api.getMessages(channelId, pageSize, before = messages.last().id).onSuccess { older ->
                messages = messages + older.filter { o -> messages.none { it.id == o.id } }
                hasMore = older.size >= pageSize
            }
            loadingMore = false
        }
    }

    val names = channel?.memberNames ?: emptyMap()
    fun nameOf(id: String) = if (id == me) app.preferencesManager.username ?: "You" else names[id] ?: "Unknown"
    val isDm = channel?.isDirectMessage == true
    val title = channel?.displayName(me) ?: channelName
    val myRole = channel?.memberRoles?.get(me) ?: channel?.userRole ?: 0

    val shown = remember(messages, search, keyVersion) {
        if (search.isBlank()) messages
        else messages.filter { m -> m.type == "text" && bodyOf(m).contains(search, ignoreCase = true) }
    }

    var uploading by remember { mutableStateOf(false) }
    fun upload(uri: android.net.Uri?, asPhoto: Boolean) {
        if (uri == null) return
        uploading = true
        scope.launch {
            sendAttachment(context, uri, channelId, asPhoto).onFailure { toast(it.message ?: "Couldn't send the file.") }
            uploading = false
        }
    }
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { upload(it, true) }
    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { upload(it, false) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { upload(it, false) }

    val recorder = remember { VoiceRecorder(context) }
    var recording by remember { mutableStateOf(false) }
    var elapsed by remember { mutableStateOf(0) }
    LaunchedEffect(recording) {
        elapsed = 0
        while (recording) { delay(1000); elapsed++ }
    }
    DisposableEffect(Unit) { onDispose { recorder.cancel() } }
    var videoFile by remember { mutableStateOf<java.io.File?>(null) }
    val captureVideo = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val f = videoFile
        videoFile = null
        if (res.resultCode == android.app.Activity.RESULT_OK && f != null && f.exists() && f.length() > 0) {
            uploading = true
            scope.launch {
                runCatching { sendVideoFile(f, channelId) }.onFailure { toast(it.message ?: "Couldn't send the video.") }
                uploading = false
            }
        } else f?.delete()
    }
    fun startVideo() {
        val dir = java.io.File(context.cacheDir, "video").apply { mkdirs() }
        val f = java.io.File(dir, "vid_${System.currentTimeMillis()}.mp4")
        videoFile = f
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", f)
        val intent = android.content.Intent(android.provider.MediaStore.ACTION_VIDEO_CAPTURE)
            .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
            .putExtra(android.provider.MediaStore.EXTRA_DURATION_LIMIT, 60)
            .putExtra(android.provider.MediaStore.EXTRA_VIDEO_QUALITY, 0)
            .addFlags(android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { captureVideo.launch(intent) }.onFailure { toast("No camera app available."); videoFile = null }
    }
    fun finishRecording() {
        recording = false
        val result = recorder.stop()
        if (result == null) { toast("Recording too short."); return }
        uploading = true
        scope.launch {
            runCatching { sendVoiceFile(result, channelId) }.onFailure { toast(it.message ?: "Couldn't send the voice message.") }
            uploading = false
        }
    }


    fun send() {
        val text = input.trim()
        if (text.isEmpty()) return
        val edit = editing
        val reply = replyTo
        scope.launch {
            val ok = if (edit != null) ws.editMessage(channelId, edit.id, text)
            else ws.sendChatMessage(channelId, text, replyToId = reply?.id)
            if (ok) {
                input = ""
                editing = null
                replyTo = null
                listState.scrollToItem(0)
            } else toast("Couldn't send. Check your connection and try again.")
        }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(c.chatCanvas)
            .navigationBarsPadding()
            .imePadding()
    ) {
        // Top bar: the card colour also fills the status-bar inset so it blends into the system bar.
        Column(Modifier.fillMaxWidth().background(c.chatCanvas).statusBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = Spacing.xs).height(52.dp).padding(end = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.size(40.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronLeft, "Back", tint = c.textPrimary, modifier = Modifier.size(26.dp).mirrorInRtl())
                }
                if (isDm) {
                    UserAvatar(channel?.members?.firstOrNull { it != me } ?: channelId, size = 30.dp, avatarId = channel?.memberAvatars?.get(channel?.members?.firstOrNull { it != me }))
                } else {
                    InitialsAvatar(channelId, title, size = 30.dp)
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                    Text(title, color = c.textPrimary, fontSize = CoveType.body.fontSize, lineHeight = 1.2.em, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!isDm) Text("${channel?.members?.size ?: 0} members", color = c.textMuted, fontSize = CoveType.caption.fontSize, lineHeight = 1.2.em, maxLines = 1)
                }
                CoveIconButton(Icons.Outlined.Search, "Search", { searching = !searching; if (!searching) search = "" }, iconSize = 21.dp)
                if (!isDm) {
                    CoveIconButton(Icons.Outlined.Groups, "Show Members", { showMembers = true }, iconSize = 21.dp)
                    CoveIconButton(Icons.Outlined.Tune, "Channel Settings", { showSettings = true }, iconSize = 21.dp)
                }
                if (isDm) channel?.members?.firstOrNull { it != me }?.let { peer ->
                    CoveIconButton(Icons.Outlined.Lock, "Start Whisper", { onStartWhisper(peer, title) }, iconSize = 21.dp)
                }
                CoveIconButton(Icons.Outlined.Phone, "Start Voice Call", { onStartCall(false) }, iconSize = 21.dp)
            }
            SectionDivider()
        }

        if (searching) {
            Box(Modifier.fillMaxWidth().padding(8.dp)) {
                CoveTextField(search, { search = it }, placeholder = "Search...", height = 36.dp)
            }
        }

        // Persistent voice-note player (shown while a voice note is loaded), like the web top player bar
        VoicePlayerBar()

        // Messages (reversed: index 0 is the newest, drawn at the bottom)
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.weight(1f).fillMaxWidth().chatBackgroundPattern()
        ) {
            items(shown.size, key = { shown[it].id }) { i ->
                val m = shown[i]
                val older = shown.getOrNull(i + 1)
                val newDay = older == null || older.localDate() != m.localDate()
                val sameBlock = older != null && !newDay && older.senderId == m.senderId &&
                    ((parseInstant(m.sentAt)?.epochSecond ?: 0) - (parseInstant(older.sentAt)?.epochSecond ?: 0)) < 300
                Column(Modifier.fillMaxWidth()) {
                    if (newDay) m.localDate()?.let { DaySeparator(dayLabel(it)) }
                    MessageRow(
                        m = m,
                        author = nameOf(m.senderId),
                        avatarId = channel?.memberAvatars?.get(m.senderId),
                        showHeader = !sameBlock,
                        selected = selectedId == m.id,
                        quoted = m.replyToId?.let { rid -> messages.firstOrNull { it.id == rid } },
                        quotedAuthor = m.replyToId?.let { rid -> messages.firstOrNull { it.id == rid }?.let { nameOf(it.senderId) } },
                        canEdit = m.senderId == me && m.type == "text",
                        canDelete = m.senderId == me || myRole >= 10,
                        keyVersion = keyVersion,
                        onMention = { u -> mentionMembers.firstOrNull { it.username.equals(u, ignoreCase = true) }?.let { profileMention = it } },
                        onToggle = { selectedId = if (selectedId == m.id) null else m.id },
                        onReply = { replyTo = m; editing = null; selectedId = null },
                        onEdit = { editing = m; replyTo = null; input = bodyOf(m); selectedId = null },
                        onDelete = {
                            selectedId = null
                            scope.launch { if (!ws.deleteMessage(channelId, m.id)) toast("Couldn't delete the message.") }
                        }
                    )
                }
            }
            item(key = "welcome") { WelcomeHeader(title, isDm) }
        }

        // @mention suggestions: tapping one inserts it (the web popup needed Enter).
        val mentionQuery = detectMention(input)
        if (mentionQuery != null) {
            MentionSuggestions(
                query = mentionQuery,
                members = filterMentionMembers(mentionMembers, me, mentionQuery),
                onPick = { input = applyMention(input, it.username) }
            )
        }

        ChatInputBar(
            input = input,
            onInputChange = { input = it },
            targetLabel = if (isDm) "@$title" else "#$title",
            context = (replyTo ?: editing)?.let { InputContext(editing != null, nameOf(it.senderId), bodyOf(it)) },
            onCancelContext = { replyTo = null; if (editing != null) { editing = null; input = "" } },
            uploading = uploading,
            recording = recording,
            elapsedSeconds = elapsed,
            onSend = { send() },
            onPickMedia = { pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
            onPickAudio = { pickAudio.launch("audio/*") },
            onPickFile = { pickFile.launch("*/*") },
            onStartRecording = { if (!uploading && recorder.start()) recording = true else toast("Couldn't start the microphone.") },
            onCancelRecording = { recording = false; recorder.cancel() },
            onFinishRecording = { finishRecording() },
            onVideo = { if (!uploading) startVideo() }
        )
    }

    profileMention?.let { m ->
        MemberProfileDialog(
            userId = m.id, username = m.username, avatarId = m.avatarId,
            onDismiss = { profileMention = null },
            onOpenChat = { id, name -> profileMention = null; if (id != channelId) onOpenChat(id, name) }
        )
    }

    val reloadChannel: () -> Unit = {
        scope.launch { api.getChannels().onSuccess { l -> channel = l.firstOrNull { it.id == channelId } } }
    }
    if (showMembers) channel?.let { MembersDialog(it, me, onDismiss = { showMembers = false }, onChanged = reloadChannel) }
    if (showSettings) channel?.let {
        ChannelSettingsDialog(
            channel = it,
            me = me,
            onDismiss = { showSettings = false },
            onChanged = reloadChannel,
            onDeleted = { showSettings = false; onBack() },
            onLeave = {
                scope.launch {
                    api.leaveChannel(channelId, me).fold(
                        onSuccess = { showSettings = false; onBack() },
                        onFailure = { e -> toast(e.message ?: "Couldn't leave the channel.") }
                    )
                }
            }
        )
    }
}

/** "Today" pill between two hairlines. */
@Composable
private fun DaySeparator(label: String) {
    val c = CoveTheme.extendedColors
    // Web: a 1px border-border/50 rule with a bg-background pill (border-border/50) centred on it.
    val hairline = c.border.copy(alpha = 0.5f)
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(hairline))
        Text(
            label, color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .clip(CircleShape)
                .background(c.chatCanvas)
                .border(1.dp, hairline, CircleShape)
                .padding(horizontal = 12.dp, vertical = 2.dp)
        )
    }
}

/** Start-of-conversation banner ("Welcome to #general!"). */
@Composable
private fun WelcomeHeader(title: String, isDm: Boolean) {
    val c = CoveTheme.extendedColors
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 48.dp, bottom = 16.dp)) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
            Text(if (isDm) "@" else "#", color = MaterialTheme.colorScheme.primary, fontSize = 30.sp, fontWeight = FontWeight.Medium)
        }
        Spacer(Modifier.height(12.dp))
        Text(
            if (isDm) title else "Welcome to #$title!",
            color = c.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp
        )
        Spacer(Modifier.height(6.dp))
        Text(
            if (isDm) "This is the beginning of your direct message history with $title."
            else "This is the start of the #$title channel.",
            color = c.textMuted, fontSize = CoveType.body.fontSize
        )
        Spacer(Modifier.height(24.dp))
        SectionDivider()
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    m: Message,
    author: String,
    avatarId: String?,
    showHeader: Boolean,
    selected: Boolean,
    quoted: Message?,
    quotedAuthor: String?,
    canEdit: Boolean,
    canDelete: Boolean,
    keyVersion: Int,
    onMention: (username: String) -> Unit,
    onToggle: () -> Unit,
    onReply: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val c = CoveTheme.extendedColors
    // keyVersion forces a re-decrypt once the channel key has arrived over the socket.
    val text = remember(m.id, m.ciphertext, keyVersion) { bodyOf(m) }
    Box(
        Modifier
            .fillMaxWidth()
            .background(if (selected) c.accent.copy(alpha = 0.35f) else Color.Transparent)
            // Long-press is reserved for copying the text (MessageText); tapping still toggles the action bar.
            .clickable(onClick = onToggle)
            .padding(horizontal = 16.dp, vertical = if (showHeader) 6.dp else 1.dp)
    ) {
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.width(42.dp)) { if (showHeader) UserAvatar(m.senderId, size = 32.dp, avatarId = avatarId) }
            Column(Modifier.weight(1f)) {
                if (showHeader) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(author, color = c.textPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.width(8.dp))
                        Text(m.timeLabel(), color = c.textMuted, fontSize = CoveType.caption.fontSize)
                    }
                }
                if (m.replyToId != null) {
                    Row(
                        Modifier.padding(vertical = 2.dp).clip(CoveShapes.sm).background(c.card).padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(Modifier.width(3.dp).height(24.dp).background(MaterialTheme.colorScheme.primary))
                        Spacer(Modifier.width(8.dp))
                        Column {
                            Text(quotedAuthor ?: "Original message", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
                            Text(quoted?.let { bodyOf(it) } ?: "Not loaded", color = c.textMuted, fontSize = CoveType.caption.fontSize, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                val fileMeta = remember(m.id, m.ciphertext, keyVersion) { m.fileMeta() }
                if (fileMeta != null) {
                    when (m.type) {
                        "voice" -> VoiceBubble(m.channelId, fileMeta, keyVersion, author)
                        "video" -> VideoBubble(m.channelId, fileMeta, keyVersion)
                        else -> if (fileMeta.mime.startsWith("video/")) VideoBubble(m.channelId, fileMeta, keyVersion) else FileBubble(m.channelId, fileMeta, keyVersion)
                    }
                } else Row(verticalAlignment = Alignment.Bottom) {
                    MessageText(
                        text, color = c.textPrimary, fontSize = CoveType.body.fontSize, linkColor = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f, fill = false), onMention = onMention
                    )
                    if (m.editedAt != null) {
                        Spacer(Modifier.width(6.dp))
                        Text("(edited)", color = c.textMuted, fontSize = 10.sp)
                    }
                }
            }
        }
        if (selected) {
            Row(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(y = (-14).dp)
                    .clip(CoveShapes.md)
                    .border(1.dp, c.border, CoveShapes.md)
                    .background(c.card)
            ) {
                CoveIconButton(Icons.AutoMirrored.Outlined.Reply, "Reply", onReply, size = 40.dp, iconSize = 18.dp)
                if (canEdit) CoveIconButton(Icons.Outlined.Edit, "Edit", onEdit, size = 40.dp, iconSize = 18.dp)
                if (canDelete) CoveIconButton(Icons.Outlined.Delete, "Delete", onDelete, size = 40.dp, iconSize = 18.dp)
            }
        }
    }
}

