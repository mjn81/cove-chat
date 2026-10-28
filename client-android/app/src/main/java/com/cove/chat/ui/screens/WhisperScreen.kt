package com.cove.chat.ui.screens

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
    val context = LocalContext.current
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

    var videoFile by remember { mutableStateOf<java.io.File?>(null) }
    val captureVideo = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val f = videoFile
        videoFile = null
        if (res.resultCode == Activity.RESULT_OK && f != null && f.exists() && f.length() > 0) {
            if (f.length() > WHISPER_MAX_BYTES) { toast("Couldn't read that file, or it is larger than 10 MB."); f.delete(); return@rememberLauncherForActivityResult }
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
        } else f?.delete()
    }
    fun startVideo() {
        val dir = java.io.File(context.cacheDir, "video").apply { mkdirs() }
        val f = java.io.File(dir, "whisper_${System.currentTimeMillis()}.mp4")
        videoFile = f
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", f)
        val intent = Intent(android.provider.MediaStore.ACTION_VIDEO_CAPTURE)
            .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
            .putExtra(android.provider.MediaStore.EXTRA_DURATION_LIMIT, 30)
            .putExtra(android.provider.MediaStore.EXTRA_VIDEO_QUALITY, 0)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { captureVideo.launch(intent) }.onFailure { toast("No camera app available."); videoFile = null }
    }

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
        Column(Modifier.fillMaxWidth().background(CoveWhisperCard).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(56.dp).padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronLeft, "Back", tint = CoveWhisperPrimary, modifier = Modifier.size(28.dp).mirrorInRtl())
                }
                UserAvatar(session.peerId, size = 36.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(session.peerName, color = CoveWhisperPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold, maxLines = 1)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, null, tint = CoveWhisperTextMuted, modifier = Modifier.size(12.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            if (session.persists) "End-to-end encrypted · ${expiryLabel(session.expiryMode)}" else "End-to-end encrypted · not stored",
                            color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize, maxLines = 1
                        )
                    }
                }
                if (session.safetyNumber != null) {
                    Box(Modifier.size(48.dp).clickable { showSafety = true }, contentAlignment = Alignment.Center) {
                        Icon(if (session.verified) Icons.Outlined.VerifiedUser else Icons.Outlined.Shield, "Safety number", tint = if (session.verified) MaterialTheme.colorScheme.primary else CoveWhisperTextMuted, modifier = Modifier.size(24.dp))
                    }
                }
                Box {
                    Box(Modifier.size(48.dp).clickable { menuOpen = true }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.MoreVert, "More", tint = CoveWhisperPrimary, modifier = Modifier.size(24.dp))
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = CoveWhisperPopover) {
                        if (live || session.status == WhisperStatus.Pending) CoveListRow("End session", compact = true, onClick = { menuOpen = false; confirmEnd = true }, titleColor = CoveWhisperPrimary, contentPadding = PaddingValues(Spacing.md))
                        CoveListRow("Burn chat", compact = true, onClick = { menuOpen = false; confirmBurn = true }, titleColor = MaterialTheme.colorScheme.error, contentPadding = PaddingValues(Spacing.md))
                    }
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(CoveWhisperAccent))
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (session.status == WhisperStatus.Pending) {
                Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = CoveWhisperPrimary, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.height(16.dp))
                    Text("Waiting for ${session.peerName} to accept…", color = CoveWhisperTextMuted, textAlign = TextAlign.Center)
                    Text("Cancel", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium, modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(16.dp))
                }
            } else if (session.status == WhisperStatus.Burned || (ended && session.messages.isEmpty())) {
                Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(if (session.status == WhisperStatus.Burned) Icons.Outlined.LocalFireDepartment else Icons.Outlined.Lock, null, tint = CoveWhisperTextMuted, modifier = Modifier.size(40.dp))
                    Spacer(Modifier.height(12.dp))
                    Text(session.endedReason ?: "This Whisper has ended.", color = CoveWhisperTextMuted, textAlign = TextAlign.Center)
                    Text("Close", color = CoveWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { manager.forget(sessionId); onBack() }.padding(16.dp))
                }
            } else {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item {
                        Text(
                            if (session.persists) "Messages are encrypted on both devices and kept only on them. Compare the safety number to verify who you're talking to."
                            else "Messages here exist only in memory on both devices. Compare the safety number to verify who you're talking to.",
                            color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
                        )
                    }
                    items(session.messages.toList(), key = { it.id }) { m -> WhisperBubble(m, mine = m.senderId == me, now = now) }
                    if (ended) item {
                        Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(session.endedReason ?: "This Whisper has ended.", color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize, textAlign = TextAlign.Center)
                            Text("Delete from this device", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium, modifier = Modifier.clickable { manager.forget(sessionId); onBack() }.padding(16.dp))
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
                AttachAction(Icons.Outlined.Videocam, "Video message") { startVideo() }
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
            val groups = (session.safetyNumber ?: "").split(" ").chunked(4)
            groups.forEach { row -> Text(row.joinToString("   "), color = CoveWhisperPrimary, style = CoveType.title, fontWeight = FontWeight.Medium, letterSpacing = 1.sp) }
            if (session.verified) Text("Verified", color = MaterialTheme.colorScheme.primary, style = CoveType.label)
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

/** One message: text or attachment, with its disappearing countdown when the session uses an expiry mode. */
@Composable
private fun WhisperBubble(m: WhisperMessage, mine: Boolean, now: Long) {
    val fg = if (mine) Color.Black else CoveWhisperPrimary
    val bg = if (mine) CoveWhisperPrimary else CoveWhisperAccent
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        if (m.file != null) WhisperFileBubble(m, mine)
        if (!m.text.isNullOrEmpty()) {
            Text(
                m.text, color = fg, fontSize = 16.sp,
                modifier = Modifier.clip(CoveShapes.md).background(bg).padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }
        m.expiresAt?.let { exp ->
            Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Schedule, null, tint = CoveWhisperTextMuted, modifier = Modifier.size(11.dp))
                Spacer(Modifier.width(3.dp))
                Text(formatRemaining(exp - now), color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize)
            }
        }
    }
}

/** Whisper composer: "+" attachment sheet, text field, and one trailing mic (tap to record) / send button. */
@Composable
private fun WhisperInputBar(
    input: String, onInput: (String) -> Unit, busy: Boolean,
    onSend: () -> Unit, onAttach: () -> Unit, onVoice: (com.cove.chat.ui.screens.VoiceRecorder.Result) -> Unit, toast: (String) -> Unit
) {
    val context = LocalContext.current
    val recorder = remember { VoiceRecorder(context) }
    var recording by remember { mutableStateOf(false) }
    var seconds by remember { mutableStateOf(0) }
    LaunchedEffect(recording) { seconds = 0; while (recording) { delay(1000); seconds++ } }
    DisposableEffect(Unit) { onDispose { recorder.cancel() } }

    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        if (recording) {
            Box(Modifier.size(48.dp).clip(CircleShape).clickable { recording = false; recorder.cancel() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Delete, "Cancel recording", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(26.dp))
            }
            Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(CoveShapes.lg).background(CoveWhisperCard).border(1.dp, CoveWhisperAccent, CoveShapes.lg).padding(horizontal = Spacing.lg), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(12.dp).clip(CircleShape).background(MaterialTheme.colorScheme.error))
                Spacer(Modifier.width(Spacing.sm))
                Text(mmss(seconds), color = CoveWhisperPrimary, fontSize = 16.sp)
            }
            Box(Modifier.size(48.dp).clip(CircleShape).background(CoveWhisperPrimary).clickable {
                recording = false
                val r = recorder.stop()
                if (r == null) toast("Recording too short.") else onVoice(r)
            }, contentAlignment = Alignment.Center) { Icon(Icons.AutoMirrored.Outlined.Send, "Send voice message", tint = Color.Black, modifier = Modifier.size(24.dp).mirrorInRtl()) }
        } else {
            Box(Modifier.size(48.dp).clip(CircleShape).background(CoveWhisperAccent).clickable(enabled = !busy, onClick = onAttach), contentAlignment = Alignment.Center) {
                if (busy) CircularProgressIndicator(color = CoveWhisperPrimary, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                else Icon(Icons.Outlined.Add, "Add attachment", tint = CoveWhisperPrimary, modifier = Modifier.size(28.dp))
            }
            Box(Modifier.weight(1f).heightIn(min = 48.dp, max = 140.dp).clip(CoveShapes.lg).background(CoveWhisperCard).border(1.dp, CoveWhisperAccent, CoveShapes.lg).padding(horizontal = Spacing.lg, vertical = 12.dp), contentAlignment = Alignment.CenterStart) {
                if (input.isEmpty()) Text("Whisper…", color = CoveWhisperTextMuted, fontSize = 16.sp)
                BasicTextField(
                    value = input, onValueChange = onInput,
                    textStyle = TextStyle(color = CoveWhisperPrimary, fontSize = 16.sp, lineHeight = 24.sp, textDirection = TextDirection.Content),
                    cursorBrush = SolidColor(CoveWhisperPrimary), modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = KeyboardCapitalization.Sentences)
                )
            }
            if (input.isNotBlank()) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(CoveWhisperPrimary).clickable(onClick = onSend), contentAlignment = Alignment.Center) {
                    Icon(Icons.AutoMirrored.Outlined.Send, "Send message", tint = Color.Black, modifier = Modifier.size(24.dp).mirrorInRtl())
                }
            } else {
                Box(Modifier.size(48.dp).clip(CircleShape).background(CoveWhisperAccent).clickable(enabled = !busy) {
                    if (recorder.start()) recording = true else toast("Couldn't start the microphone.")
                }, contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Mic, "Record voice message", tint = CoveWhisperPrimary, modifier = Modifier.size(24.dp)) }
            }
        }
    }
}
