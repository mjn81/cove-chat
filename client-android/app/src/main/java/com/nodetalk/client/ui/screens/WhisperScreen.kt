package com.nodetalk.client.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.ColumnScope
import com.nodetalk.client.ui.components.CoveButton
import com.nodetalk.client.ui.components.ButtonVariant
import com.nodetalk.client.ui.components.ButtonSize
import com.nodetalk.client.ui.components.CoveDialog
import com.nodetalk.client.ui.components.DialogSize
import com.nodetalk.client.ui.components.CoveListRow
import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Spacing
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.mirrorInRtl
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.nodetalk.client.CoveApp
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.CoveWhisperAccent
import com.nodetalk.client.ui.theme.CoveWhisperBg
import com.nodetalk.client.ui.theme.CoveWhisperCard
import com.nodetalk.client.ui.theme.CoveWhisperPrimary
import com.nodetalk.client.ui.theme.CoveWhisperTextMuted
import com.nodetalk.client.whisper.WhisperInvite
import com.nodetalk.client.whisper.WhisperStatus

private val ExpiryChoices = listOf(
    "persistent" to "Keep until closed",
    "5m" to "Disappear after 5 minutes",
    "1h" to "Disappear after 1 hour",
    "24h" to "Disappear after 24 hours",
    "session_only" to "Session only (nothing kept)"
)

/** Chooser shown before starting a Whisper; the message expiry is agreed here (same modes as the web client). */
@Composable
fun WhisperStartDialog(peerName: String, onDismiss: () -> Unit, onStart: (expiryMode: String) -> Unit) {
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
 * Whisper chat in the web client's pitch-black "whisper mode" palette. Messages live only in memory:
 * leaving with End Session (or the peer ending it) discards every key and message.
 */
@Composable
fun WhisperScreen(sessionId: String, onBack: () -> Unit) {
    val manager = CoveApp.instance.whisperManager
    val me = CoveApp.instance.preferencesManager.userId.orEmpty()
    val session = manager.sessions[sessionId]
    var input by remember { mutableStateOf("") }
    var showSafety by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(session?.messages?.size) { if ((session?.messages?.size ?: 0) > 0) listState.animateScrollToItem(session!!.messages.size - 1) }

    if (session == null) {
        // Session already ended and removed.
        Box(Modifier.fillMaxSize().background(CoveWhisperBg).statusBarsPadding(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("This Whisper has ended.", color = CoveWhisperTextMuted)
                Text("Back", color = CoveWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onBack).padding(12.dp))
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().background(CoveWhisperBg).navigationBarsPadding().imePadding()) {
        Column(Modifier.fillMaxWidth().background(CoveWhisperCard).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(52.dp).padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronLeft, "Back", tint = CoveWhisperPrimary, modifier = Modifier.size(26.dp).mirrorInRtl())
                }
                UserAvatar(session.peerId, size = 36.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(session.peerName, color = CoveWhisperPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold, maxLines = 1)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, null, tint = CoveWhisperTextMuted, modifier = Modifier.size(12.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("End-to-end encrypted · not stored", color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize)
                    }
                }
                if (session.status == WhisperStatus.Active) {
                    Box(Modifier.size(36.dp).clickable { showSafety = true }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Shield, "Safety number", tint = CoveWhisperTextMuted)
                    }
                    Text(
                        "End", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold, fontSize = CoveType.label.fontSize,
                        modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(8.dp)
                    )
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(CoveWhisperAccent))
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (session.status) {
                WhisperStatus.Pending -> Column(
                    Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    CircularProgressIndicator(color = CoveWhisperPrimary, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.height(16.dp))
                    Text("Waiting for ${session.peerName} to accept…", color = CoveWhisperTextMuted, textAlign = TextAlign.Center)
                    Text("Cancel", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium, modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(16.dp))
                }
                WhisperStatus.Closed -> Column(
                    Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(session.endedReason ?: "This Whisper has ended.", color = CoveWhisperTextMuted, textAlign = TextAlign.Center)
                    Text("Close", color = CoveWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(16.dp))
                }
                WhisperStatus.Active -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item {
                        Text(
                            "Messages here exist only in memory on both devices. Compare the safety number to verify who you're talking to.",
                            color = CoveWhisperTextMuted, fontSize = CoveType.caption.fontSize, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
                        )
                    }
                    items(session.messages.toList(), key = { it.id }) { m ->
                        val mine = m.senderId == me
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                            Text(
                                m.text, color = if (mine) Color.Black else CoveWhisperPrimary, fontSize = CoveType.body.fontSize,
                                modifier = Modifier.clip(CoveShapes.md).background(if (mine) CoveWhisperPrimary else CoveWhisperAccent).padding(horizontal = 12.dp, vertical = 8.dp)
                            )
                        }
                    }
                }
            }
        }

        if (session.status == WhisperStatus.Active) {
            Row(
                Modifier.fillMaxWidth().padding(8.dp).clip(CoveShapes.sm).background(CoveWhisperCard).border(1.dp, CoveWhisperAccent, CoveShapes.sm).padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.weight(1f).height(40.dp), contentAlignment = Alignment.CenterStart) {
                    if (input.isEmpty()) Text("Whisper…", color = CoveWhisperTextMuted, fontSize = CoveType.body.fontSize)
                    BasicTextField(
                        value = input, onValueChange = { input = it },
                        textStyle = TextStyle(color = CoveWhisperPrimary, fontSize = CoveType.body.fontSize),
                        cursorBrush = SolidColor(CoveWhisperPrimary), modifier = Modifier.fillMaxWidth()
                    )
                }
                Box(
                    Modifier.size(36.dp).clip(CoveShapes.sm).background(if (input.isNotBlank()) CoveWhisperPrimary else Color.Transparent)
                        .clickable(enabled = input.isNotBlank()) { manager.send(sessionId, input.trim()); input = "" },
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.AutoMirrored.Outlined.Send, "Send", tint = if (input.isNotBlank()) Color.Black else CoveWhisperTextMuted, modifier = Modifier.size(20.dp)) }
            }
        }
    }

    if (showSafety) {
        WhisperDialog(
            title = "Safety number", onDismiss = { showSafety = false },
            footer = { WhisperPrimaryButton("Close") { showSafety = false } }
        ) {
            Text("If this matches the number on ${session.peerName}'s device, nobody is intercepting your Whisper.", color = CoveWhisperTextMuted, style = CoveType.label, fontWeight = FontWeight.Normal)
            val groups = (session.safetyNumber ?: "").split(" ").chunked(4)
            groups.forEach { row -> Text(row.joinToString("   "), color = CoveWhisperPrimary, style = CoveType.title, fontWeight = FontWeight.Medium, letterSpacing = 1.sp) }
        }
    }
}
