package com.nodetalk.client.ui.screens

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
import androidx.compose.material3.Text
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
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTWhisperAccent
import com.nodetalk.client.ui.theme.NTWhisperBg
import com.nodetalk.client.ui.theme.NTWhisperCard
import com.nodetalk.client.ui.theme.NTWhisperPrimary
import com.nodetalk.client.ui.theme.NTWhisperTextMuted
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
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(NTWhisperBg).border(1.dp, NTWhisperAccent, RoundedCornerShape(8.dp)).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Start a Whisper with $peerName", color = NTWhisperPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(
                "Whispers are end-to-end encrypted and never stored on the server. Both of you must be online and friends.",
                color = NTWhisperTextMuted, fontSize = 13.sp
            )
            ExpiryChoices.forEach { (id, label) ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp))
                        .border(1.dp, if (id == mode) NTWhisperPrimary else NTWhisperAccent, RoundedCornerShape(6.dp))
                        .clickable { mode = id }.padding(12.dp)
                ) { Text(label, color = if (id == mode) NTWhisperPrimary else NTWhisperTextMuted, fontSize = 14.sp) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Text("Cancel", color = NTWhisperTextMuted, modifier = Modifier.clickable(onClick = onDismiss).padding(12.dp))
                Text(
                    "Start", color = Color.Black, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(NTWhisperPrimary).clickable { onStart(mode) }.padding(horizontal = 20.dp, vertical = 12.dp)
                )
            }
        }
    }
}

/** Incoming request prompt, shown over whatever screen is open. */
@Composable
fun WhisperInviteDialog(invite: WhisperInvite, onAccept: () -> Unit, onDecline: () -> Unit) {
    Dialog(onDismissRequest = onDecline) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(NTWhisperBg).border(1.dp, NTWhisperAccent, RoundedCornerShape(8.dp)).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Lock, null, tint = NTWhisperPrimary)
                Spacer(Modifier.width(8.dp))
                Text("Whisper request", color = NTWhisperPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }
            Text(
                "${invite.initiatorName} wants to start an end-to-end encrypted Whisper. Nothing is stored on the server.",
                color = NTWhisperTextMuted, fontSize = 14.sp
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Text("Decline", color = NTDestructive, fontWeight = FontWeight.Medium, modifier = Modifier.clickable(onClick = onDecline).padding(12.dp))
                Text(
                    "Accept", color = Color.Black, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(NTWhisperPrimary).clickable(onClick = onAccept).padding(horizontal = 20.dp, vertical = 12.dp)
                )
            }
        }
    }
}

/**
 * Whisper chat in the web client's pitch-black "whisper mode" palette. Messages live only in memory:
 * leaving with End Session (or the peer ending it) discards every key and message.
 */
@Composable
fun WhisperScreen(sessionId: String, onBack: () -> Unit) {
    val manager = NodeTalkApp.instance.whisperManager
    val me = NodeTalkApp.instance.preferencesManager.userId.orEmpty()
    val session = manager.sessions[sessionId]
    var input by remember { mutableStateOf("") }
    var showSafety by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(session?.messages?.size) { if ((session?.messages?.size ?: 0) > 0) listState.animateScrollToItem(session!!.messages.size - 1) }

    if (session == null) {
        // Session already ended and removed.
        Box(Modifier.fillMaxSize().background(NTWhisperBg).statusBarsPadding(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("This Whisper has ended.", color = NTWhisperTextMuted)
                Text("Back", color = NTWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onBack).padding(12.dp))
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().background(NTWhisperBg).navigationBarsPadding().imePadding()) {
        Column(Modifier.fillMaxWidth().background(NTWhisperCard).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(52.dp).padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.ChevronLeft, "Back", tint = NTWhisperPrimary, modifier = Modifier.size(26.dp))
                }
                UserAvatar(session.peerId, size = 36.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(session.peerName, color = NTWhisperPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, null, tint = NTWhisperTextMuted, modifier = Modifier.size(12.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("End-to-end encrypted · not stored", color = NTWhisperTextMuted, fontSize = 11.sp)
                    }
                }
                if (session.status == WhisperStatus.Active) {
                    Box(Modifier.size(36.dp).clickable { showSafety = true }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Shield, "Safety number", tint = NTWhisperTextMuted)
                    }
                    Text(
                        "End", color = NTDestructive, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                        modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(8.dp)
                    )
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(NTWhisperAccent))
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (session.status) {
                WhisperStatus.Pending -> Column(
                    Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    CircularProgressIndicator(color = NTWhisperPrimary, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.height(16.dp))
                    Text("Waiting for ${session.peerName} to accept…", color = NTWhisperTextMuted, textAlign = TextAlign.Center)
                    Text("Cancel", color = NTDestructive, fontWeight = FontWeight.Medium, modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(16.dp))
                }
                WhisperStatus.Closed -> Column(
                    Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(session.endedReason ?: "This Whisper has ended.", color = NTWhisperTextMuted, textAlign = TextAlign.Center)
                    Text("Close", color = NTWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { manager.close(sessionId); onBack() }.padding(16.dp))
                }
                WhisperStatus.Active -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item {
                        Text(
                            "Messages here exist only in memory on both devices. Compare the safety number to verify who you're talking to.",
                            color = NTWhisperTextMuted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
                        )
                    }
                    items(session.messages.toList(), key = { it.id }) { m ->
                        val mine = m.senderId == me
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                            Text(
                                m.text, color = if (mine) Color.Black else NTWhisperPrimary, fontSize = 15.sp,
                                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (mine) NTWhisperPrimary else NTWhisperAccent).padding(horizontal = 12.dp, vertical = 8.dp)
                            )
                        }
                    }
                }
            }
        }

        if (session.status == WhisperStatus.Active) {
            Row(
                Modifier.fillMaxWidth().padding(8.dp).clip(RoundedCornerShape(4.dp)).background(NTWhisperCard).border(1.dp, NTWhisperAccent, RoundedCornerShape(4.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.weight(1f).height(40.dp), contentAlignment = Alignment.CenterStart) {
                    if (input.isEmpty()) Text("Whisper…", color = NTWhisperTextMuted, fontSize = 15.sp)
                    BasicTextField(
                        value = input, onValueChange = { input = it },
                        textStyle = TextStyle(color = NTWhisperPrimary, fontSize = 15.sp),
                        cursorBrush = SolidColor(NTWhisperPrimary), modifier = Modifier.fillMaxWidth()
                    )
                }
                Box(
                    Modifier.size(36.dp).clip(RoundedCornerShape(4.dp)).background(if (input.isNotBlank()) NTWhisperPrimary else Color.Transparent)
                        .clickable(enabled = input.isNotBlank()) { manager.send(sessionId, input.trim()); input = "" },
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.AutoMirrored.Outlined.Send, "Send", tint = if (input.isNotBlank()) Color.Black else NTWhisperTextMuted, modifier = Modifier.size(20.dp)) }
            }
        }
    }

    if (showSafety) {
        Dialog(onDismissRequest = { showSafety = false }) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(NTWhisperBg).border(1.dp, NTWhisperAccent, RoundedCornerShape(8.dp)).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Safety number", color = NTWhisperPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("If this matches the number on ${session.peerName}'s device, nobody is intercepting your Whisper.", color = NTWhisperTextMuted, fontSize = 13.sp)
                val groups = (session.safetyNumber ?: "").split(" ").chunked(4)
                groups.forEach { row -> Text(row.joinToString("   "), color = NTWhisperPrimary, fontSize = 18.sp, fontWeight = FontWeight.Medium, letterSpacing = 1.sp) }
                Text("Close", color = NTWhisperPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.End).clickable { showSafety = false }.padding(8.dp))
            }
        }
    }
}
