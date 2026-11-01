package com.cove.chat.ui.screens

import com.cove.chat.ui.components.MessageText
import com.cove.chat.ui.components.chatBackgroundPattern
import com.cove.chat.ui.components.SectionDivider
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.WhisperTheme
import androidx.compose.ui.unit.em
import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.layout.widthIn
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.CoveApp
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveConfirmDialog
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.components.DialogSize
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.components.mirrorInRtl
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.CoveWhisperAccent
import com.cove.chat.ui.theme.CoveWhisperBg
import com.cove.chat.ui.theme.CoveWhisperCard
import com.cove.chat.ui.theme.CoveWhisperPopover
import com.cove.chat.ui.theme.CoveWhisperPrimary
import com.cove.chat.ui.theme.CoveWhisperTextMuted
import com.cove.chat.ui.theme.Spacing
import com.cove.chat.whisper.WhisperFile
import com.cove.chat.whisper.WhisperInvite
import com.cove.chat.whisper.WhisperMessage
import com.cove.chat.whisper.WhisperStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val ExpiryChoices = listOf(
    "persistent" to "Keep until closed",
    "5m" to "Disappear after 5 minutes",
    "1h" to "Disappear after 1 hour",
    "24h" to "Disappear after 24 hours",
    "session_only" to "Session only (nothing kept)"
)

private fun expiryLabel(mode: String) = ExpiryChoices.firstOrNull { it.first == mode }?.second ?: mode

/**
 * Chooser shown before starting a Whisper; the message expiry is agreed here (same modes as the web client).
 * When an ended Whisper with this friend is still saved on the device, [onOpenSaved] lets the user read it.
 */
@Composable
fun WhisperStartDialog(peerName: String, onDismiss: () -> Unit, onStart: (expiryMode: String) -> Unit, onOpenSaved: (() -> Unit)? = null) {
    var mode by remember { mutableStateOf("persistent") }
    WhisperDialog(
        title = "Start a Whisper with $peerName", onDismiss = onDismiss,
        footer = {
            CoveButton("Cancel", onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = CoveWhisperTextMuted)
            WhisperPrimaryButton("Start") { onStart(mode) }
        }
    ) {
        Text(
            "Whispers are end-to-end encrypted and never stored on the server. Both of you must be online and friends.",
            color = CoveWhisperTextMuted, style = CoveType.label, fontWeight = FontWeight.Normal
        )
        ExpiryChoices.forEach { (id, label) ->
            val on = id == mode
            CoveListRow(
                title = label, onClick = { mode = id },
                titleColor = if (on) CoveWhisperPrimary else CoveWhisperTextMuted,
                contentPadding = PaddingValues(Spacing.md),
                modifier = Modifier.border(1.dp, if (on) CoveWhisperPrimary else CoveWhisperAccent, CoveShapes.md)
            )
        }
        if (onOpenSaved != null) {
            CoveButton("View saved Whisper messages", onOpenSaved, Modifier.fillMaxWidth(), variant = ButtonVariant.Outline, size = ButtonSize.Sm, contentColor = CoveWhisperPrimary)
        }
    }
}

/** Incoming request prompt, shown over whatever screen is open. */
@Composable
fun WhisperInviteDialog(invite: WhisperInvite, onAccept: () -> Unit, onDecline: () -> Unit) {
    WhisperDialog(
        title = "Whisper request", onDismiss = onDecline,
        footer = {
            CoveButton("Decline", onDecline, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.error)
            WhisperPrimaryButton("Accept", onAccept)
        }
    ) {
        Text(
            "${invite.initiatorName} wants to start an end-to-end encrypted Whisper. Nothing is stored on the server.",
            color = CoveWhisperTextMuted, style = CoveType.body
        )
        Text(expiryLabel(invite.expiryMode), color = CoveWhisperPrimary, style = CoveType.label)
    }
}

/** [CoveDialog] in the pitch-black Whisper palette (no close button; footer actions decide). */
@Composable
private fun WhisperDialog(
    title: String,
    onDismiss: () -> Unit,
    footer: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    CoveDialog(
        onDismiss = onDismiss, title = title, size = DialogSize.Sm, showClose = false,
        container = CoveWhisperBg, border = CoveWhisperAccent, titleColor = CoveWhisperPrimary, footerContainer = CoveWhisperCard,
        footer = footer
    ) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md), content = content)
    }
}

@Composable
private fun WhisperPrimaryButton(text: String, onClick: () -> Unit) {
    CoveButton(text, onClick, size = ButtonSize.Sm, containerColor = CoveWhisperPrimary, contentColor = Color.Black)
}

/**
 * Whisper chat in the web client's pitch-black "whisper mode" palette. Keys and plaintext live in memory (and, for the
 * history-keeping expiry modes, in the encrypted device-local store); End keeps the saved history, Burn destroys the
 * chat on both devices. Messages show a countdown when the session uses an expiry mode.
 */
@Composable
fun WhisperScreen(sessionId: String, onBack: () -> Unit) {
    WhisperTheme { WhisperScreenContent(sessionId, onBack) }
}

@Composable
private fun WhisperScreenContent(sessionId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    val manager = CoveApp.instance.whisperManager
    val me = CoveApp.instance.preferencesManager.userId.orEmpty()
    val session = manager.sessions[sessionId]
    var input by remember { mutableStateOf("") }
    var showSafety by remember { mutableStateOf(false) }
    var confirmBurn by remember { mutableStateOf(false) }
    var confirmEnd by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var sheetOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val listState = rememberLazyListState()
    fun toast(msg: String) = I18nToast.make(context, msg, android.widget.Toast.LENGTH_SHORT).show()

    DisposableEffect(sessionId) {
        manager.openSessionId = sessionId
        manager.ensureMessages(sessionId)
        onDispose { if (manager.openSessionId == sessionId) manager.openSessionId = null }
    }
    // One shared clock for every countdown on screen; only ticks while some message can expire.
    val hasExpiring = session?.messages?.any { it.expiresAt != null } == true
    LaunchedEffect(hasExpiring) { while (hasExpiring) { now = System.currentTimeMillis(); delay(1000) } }
    LaunchedEffect(session?.messages?.size) { if ((session?.messages?.size ?: 0) > 0) listState.animateScrollToItem(session!!.messages.size) }

    fun sendPicked(uri: android.net.Uri?, asMedia: Boolean) {
        if (uri == null) return
        busy = true
        scope.launch {
            val read = readWhisperUri(context, uri)
            if (read == null) toast("Couldn't read that file, or it is larger than 10 MB.")
            else {
                val (bytes, mime, name) = read
                val kind = if (mime.startsWith("video/")) "video" else if (mime.startsWith("audio/") && !asMedia) "voice" else "file"
                manager.sendFile(sessionId, WhisperFile(name, mime, bytes.size.toLong(), kind, null, null, bytes))
            }
            busy = false
        }
    }
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { sendPicked(it, true) }
    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { sendPicked(it, false) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { sendPicked(it, false) }

    var showVideoRecorder by remember { mutableStateOf(false) }
    if (showVideoRecorder) VideoMessageDialog(
        maxSeconds = 30,
        onDismiss = { showVideoRecorder = false },
        onSend = { f ->
            showVideoRecorder = false
            if (f.length() > WHISPER_MAX_BYTES) { toast("Couldn't read that file, or it is larger than 10 MB."); f.delete() }
            else {
                busy = true
                scope.launch {
                    runCatching {
                        var seconds: Int? = null
                        runCatching {
                            val r = android.media.MediaMetadataRetriever()
                            r.setDataSource(f.absolutePath)
                            seconds = ((r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000).toInt()
                            r.release()
                        }
                        val bytes = f.readBytes()
                        manager.sendFile(sessionId, WhisperFile("video-message.mp4", "video/mp4", bytes.size.toLong(), "video", seconds, null, bytes))
                    }
                    f.delete()
                    busy = false
                }
            }
        }
    )

    if (session == null) {
        Box(Modifier.fillMaxSize().background(CoveWhisperBg).statusBarsPadding(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("This Whisper has ended.", color = CoveWhisperTextMuted)
                Text("Back", color = CoveWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onBack).padding(12.dp))
            }
        }
        return
    }
    val live = session.status == WhisperStatus.Active
    val ended = session.status == WhisperStatus.Closed || session.status == WhisperStatus.Burned

    Column(Modifier.fillMaxSize().background(CoveWhisperBg).navigationBarsPadding().imePadding()) {
        // Same top bar as the main chat (back, avatar, name and a status line on the left, actions on the right).
        Column(Modifier.fillMaxWidth().background(c.chatCanvas).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(56.dp).padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronLeft, "Back", tint = c.textPrimary, modifier = Modifier.size(26.dp).mirrorInRtl())
                }
                Box {
                    UserAvatar(session.peerId, size = 38.dp)
                    Box(Modifier.align(Alignment.BottomEnd).size(16.dp).clip(CircleShape).background(c.chatCanvas), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Lock, null, tint = c.textPrimary, modifier = Modifier.size(10.dp))
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                    Text(session.peerName, color = c.textPrimary, fontSize = CoveType.body.fontSize, lineHeight = 1.2.em, fontWeight = FontWeight.Bold, maxLines = 1)
                    Text(
                        if (session.persists) "End-to-end encrypted · ${expiryLabel(session.expiryMode)}" else "End-to-end encrypted · not stored",
                        color = c.textMuted, fontSize = CoveType.caption.fontSize, lineHeight = 1.2.em, maxLines = 1
                    )
                }
                if (session.safetyNumber != null) {
                    CoveIconButton(
                        if (session.verified) Icons.Outlined.VerifiedUser else Icons.Outlined.Shield, "Safety number", { showSafety = true },
                        iconSize = 21.dp, tint = if (session.verified) MaterialTheme.colorScheme.primary else c.textMuted
                    )
                }
                Box {
                    CoveIconButton(Icons.Outlined.MoreVert, "More", { menuOpen = true }, iconSize = 21.dp)
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = c.popover) {
                        if (live || session.status == WhisperStatus.Pending) CoveListRow("End session", compact = true, onClick = { menuOpen = false; confirmEnd = true }, titleColor = c.textPrimary, contentPadding = PaddingValues(Spacing.md))
                        CoveListRow("Burn chat", compact = true, onClick = { menuOpen = false; confirmBurn = true }, titleColor = MaterialTheme.colorScheme.error, contentPadding = PaddingValues(Spacing.md))
                    }
                }
            }
            SectionDivider()
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (session.status == WhisperStatus.Pending) {
                WhisperStateScreen(Icons.Outlined.Lock, pulse = true, message = "Waiting for ${session.peerName} to accept…") {
                    CoveButton("Cancel request", { manager.close(sessionId); onBack() }, variant = ButtonVariant.Outline, size = ButtonSize.Md, contentColor = MaterialTheme.colorScheme.error)
                }
            } else if (session.status == WhisperStatus.Burned || (ended && session.messages.isEmpty())) {
                WhisperStateScreen(
                    if (session.status == WhisperStatus.Burned) Icons.Outlined.LocalFireDepartment else Icons.Outlined.Lock,
                    pulse = false, message = session.endedReason ?: "This Whisper has ended."
                ) {
                    WhisperPrimaryButton("Close") { manager.forget(sessionId); onBack() }
                }
            } else {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize().chatBackgroundPattern(), contentPadding = PaddingValues(bottom = 8.dp)) {
                    item { WhisperNotice(session.peerName, session.persists) }
                    val msgs = session.messages.toList()
                    itemsIndexed(msgs, key = { _, m -> m.id }) { i, m ->
                        val prev = msgs.getOrNull(i - 1)
                        val newDay = prev == null || whisperDay(prev.sentAt) != whisperDay(m.sentAt)
                        // Same grouping rule as the main chat: one header per sender within five minutes.
                        val sameBlock = prev != null && !newDay && prev.senderId == m.senderId && (m.sentAt - prev.sentAt) < 5 * 60_000L
                        if (newDay) DaySeparator(dayLabel(whisperDay(m.sentAt)))
                        val mine = m.senderId == me
                        WhisperRow(
                            m, mine = mine, author = if (mine) CoveApp.instance.preferencesManager.username.orEmpty() else session.peerName,
                            avatarId = if (mine) CoveApp.instance.preferencesManager.avatarId else null,
                            showHeader = !sameBlock, now = now, expiryMode = session.expiryMode
                        )
                    }
                    if (ended) item {
                        Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(session.endedReason ?: "This Whisper has ended.", color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize, textAlign = TextAlign.Center)
                            CoveButton("Delete from this device", { manager.forget(sessionId); onBack() }, variant = ButtonVariant.Outline, size = ButtonSize.Sm, contentColor = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        if (live) {
            WhisperInputBar(
                input = input, onInput = { input = it }, busy = busy,
                onSend = { manager.send(sessionId, input.trim()); input = "" },
                onAttach = { sheetOpen = true },
                onVoice = { result ->
                    scope.launch {
                        runCatching {
                            val bytes = result.file.readBytes()
                            manager.sendFile(sessionId, WhisperFile("voice-message.m4a", "audio/mp4", bytes.size.toLong(), "voice", result.seconds, result.peaks.map { it.toInt() }, bytes))
                        }
                        result.file.delete()
                    }
                },
                toast = ::toast
            )
        }
    }

    if (sheetOpen) {
        AttachmentSheet(
            listOf(
                AttachAction(Icons.Outlined.Image, "Photo or Video") { pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
                AttachAction(Icons.Outlined.MusicNote, "Audio") { pickAudio.launch("audio/*") },
                AttachAction(Icons.Outlined.Description, "Document / File") { pickFile.launch("*/*") },
                AttachAction(Icons.Outlined.Videocam, "Video message") { showVideoRecorder = true }
            ),
            container = CoveWhisperPopover, accent = CoveWhisperPrimary, labelColor = CoveWhisperPrimary, onDismiss = { sheetOpen = false }
        )
    }

    if (showSafety) {
        WhisperDialog(
            title = "Safety number", onDismiss = { showSafety = false },
            footer = {
                CoveButton(if (session.verified) "Mark as not verified" else "Mark as verified", { manager.setVerified(sessionId, !session.verified) }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = CoveWhisperTextMuted)
                WhisperPrimaryButton("Close") { showSafety = false }
            }
        ) {
            Text("If this matches the number on ${session.peerName}'s device, nobody is intercepting your Whisper.", color = CoveWhisperTextMuted, style = CoveType.label, fontWeight = FontWeight.Normal)
            // 12 groups of 5 digits laid out as a 3-column grid, easy to read aloud and compare.
            val rows = (session.safetyNumber ?: "").split(" ").filter { it.isNotBlank() }.chunked(3)
            Column(Modifier.fillMaxWidth().clip(CoveShapes.md).background(CoveWhisperCard).padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                rows.forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        row.forEach { group -> androidx.compose.material3.Text(group, color = CoveWhisperPrimary, fontSize = 18.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, fontWeight = FontWeight.Medium, letterSpacing = 1.sp) }
                    }
                }
            }
            if (session.verified) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.VerifiedUser, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Verified", color = MaterialTheme.colorScheme.primary, style = CoveType.label)
                }
            }
        }
    }
    if (confirmEnd) {
        WhisperDialog(
            title = "End this Whisper?", onDismiss = { confirmEnd = false },
            footer = {
                CoveButton("Cancel", { confirmEnd = false }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, contentColor = CoveWhisperTextMuted)
                WhisperPrimaryButton("End session") { confirmEnd = false; manager.close(sessionId); if (!session.persists) onBack() }
            }
        ) { Text(if (session.persists) "The session ends for both of you. Saved messages stay on this device until you delete them." else "The session ends for both of you and every message is discarded.", color = CoveWhisperTextMuted, style = CoveType.body) }
    }
    if (confirmBurn) {
        CoveConfirmDialog(
            title = "Burn this chat?", message = "Every message, key and saved copy is destroyed on both devices. This can't be undone.",
            confirmLabel = "Burn", destructive = true, onDismiss = { confirmBurn = false },
            onConfirm = { confirmBurn = false; manager.burn(sessionId); onBack() }
        )
    }
}

/** Total lifetime of a message in a timed session, for the countdown bar; null when messages do not expire by time. */
private fun expiryTotalMs(mode: String): Long? = when (mode) {
    "5m" -> 5 * 60_000L
    "1h" -> 60 * 60_000L
    "24h" -> 24 * 60 * 60_000L
    else -> null
}

private fun whisperDay(ms: Long): java.time.LocalDate = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault()).toLocalDate()

private fun whisperTime(ms: Long): String =
    java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault())
        .format(java.time.format.DateTimeFormatter.ofLocalizedTime(java.time.format.FormatStyle.SHORT))

/**
 * One message laid out exactly like a row of the main chat: avatar column, then name and time, then the content. Text goes
 * through [MessageText] (links, long-press copy) and is never run through the UI translator, since it is the user's own
 * words. Timed sessions add a live countdown and a bar that drains as the message nears its disappearance.
 */
@Composable
private fun WhisperRow(m: WhisperMessage, mine: Boolean, author: String, avatarId: String?, showHeader: Boolean, now: Long, expiryMode: String) {
    val c = CoveTheme.extendedColors
    val total = expiryTotalMs(expiryMode)
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = if (showHeader) 6.dp else 1.dp)) {
        Box(Modifier.width(42.dp)) { if (showHeader) UserAvatar(m.senderId, size = 32.dp, avatarId = avatarId) }
        Column(Modifier.weight(1f)) {
            if (showHeader) {
                Row(verticalAlignment = Alignment.Bottom) {
                    androidx.compose.material3.Text(author, color = c.textPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                    androidx.compose.material3.Text(whisperTime(m.sentAt), color = c.textMuted, fontSize = CoveType.caption.fontSize)
                }
            }
            if (m.file != null) WhisperFileBubble(m, mine)
            if (!m.text.isNullOrEmpty()) {
                MessageText(m.text, color = c.textPrimary, fontSize = CoveType.body.fontSize, linkColor = MaterialTheme.colorScheme.primary)
            }
            val exp = m.expiresAt
            if (exp != null) {
                Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Schedule, null, tint = c.textMuted, modifier = Modifier.size(11.dp))
                    Spacer(Modifier.width(3.dp))
                    Text(formatRemaining(exp - now), color = c.textMuted, fontSize = CoveType.caption.fontSize)
                }
                if (total != null) {
                    Box(Modifier.padding(top = 3.dp).widthIn(max = 160.dp).fillMaxWidth().height(2.dp).clip(CircleShape).background(c.textMuted.copy(alpha = 0.18f))) {
                        Box(Modifier.fillMaxWidth(((exp - now).toFloat() / total).coerceIn(0f, 1f)).height(2.dp).background(c.textMuted))
                    }
                }
            }
        }
    }
}

/** The start-of-conversation banner, in the same place and style as the main chat's welcome header. */
@Composable
private fun WhisperNotice(peerName: String, persists: Boolean) {
    val c = CoveTheme.extendedColors
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 32.dp, bottom = 16.dp)) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Lock, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(12.dp))
        androidx.compose.material3.Text(peerName, color = c.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
        Spacer(Modifier.height(6.dp))
        Text(
            if (persists) "Messages are encrypted on both devices and kept only on them. Compare the safety number to verify who you're talking to."
            else "Messages here exist only in memory on both devices. Compare the safety number to verify who you're talking to.",
            color = c.textMuted, fontSize = CoveType.body.fontSize
        )
        Spacer(Modifier.height(24.dp))
        SectionDivider()
    }
}

/** Big status graphic (icon in a soft disc), message and actions, used for the pending, ended and burned screens. */
@Composable
private fun WhisperStateScreen(icon: androidx.compose.ui.graphics.vector.ImageVector, pulse: Boolean, message: String, actions: @Composable ColumnScope.() -> Unit) {
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "whisperPulse")
    val scale by transition.animateFloat(
        1f, if (pulse) 1.12f else 1f,
        androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(1100), androidx.compose.animation.core.RepeatMode.Reverse), label = "pulseScale"
    )
    val glow by transition.animateFloat(
        if (pulse) 0.35f else 0.0f, if (pulse) 0.0f else 0.0f,
        androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(1100), androidx.compose.animation.core.RepeatMode.Reverse), label = "pulseGlow"
    )
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.size(96.dp).graphicsLayer { scaleX = scale; scaleY = scale }.clip(CircleShape).background(CoveWhisperPrimary.copy(alpha = glow)))
            Box(Modifier.size(72.dp).clip(CircleShape).background(CoveWhisperAccent), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = CoveWhisperPrimary, modifier = Modifier.size(32.dp))
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(message, color = CoveWhisperTextMuted, textAlign = TextAlign.Center, fontSize = CoveType.body.fontSize)
        Spacer(Modifier.height(20.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), content = actions)
    }
}

/**
 * Whisper composer. The very same component as the main chat (pill, emoji, mic/send swap, hold-to-talk with slide gestures),
 * recoloured by [WhisperTheme]; attachments open the Whisper screen's own sheet and nothing is uploaded to the server.
 */
@Composable
private fun WhisperInputBar(
    input: String, onInput: (String) -> Unit, busy: Boolean,
    onSend: () -> Unit, onAttach: () -> Unit, onVoice: (com.cove.chat.ui.screens.VoiceRecorder.Result) -> Unit, toast: (String) -> Unit
) {
    val context = LocalContext.current
    val recorder = remember { VoiceRecorder(context) }
    var recording by remember { mutableStateOf(false) }
    var seconds by remember { mutableStateOf(0) }
    var pending by remember { mutableStateOf<VoiceRecorder.Result?>(null) }
    LaunchedEffect(recording) { seconds = 0; while (recording) { delay(1000); seconds++ } }
    DisposableEffect(Unit) { onDispose { recorder.cancel(); pending?.file?.delete() } }

    ChatInputBar(
        input = input, onInputChange = onInput, targetLabel = "", placeholder = "Whisper…",
        context = null, onCancelContext = {},
        uploading = busy, recording = recording, elapsedSeconds = seconds,
        onSend = onSend, onAttach = onAttach,
        onStartRecording = { if (recorder.start()) recording = true else toast("Couldn't start the microphone.") },
        onCancelRecording = { recording = false; recorder.cancel() },
        onFinishRecording = {
            recording = false
            val r = recorder.stop()
            if (r == null) toast("Recording too short.") else onVoice(r)
        },
        onStopRecording = {
            recording = false
            val r = recorder.stop()
            if (r == null) toast("Recording too short.") else pending = r
        },
        liveLevels = recorder.liveLevels,
        pendingVoice = pending,
        onSendPendingVoice = { r -> pending = null; onVoice(r) },
        onDiscardPendingVoice = { pending?.file?.delete(); pending = null }
    )
}
