package com.nodetalk.client.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.nodetalk.client.notify.IncomingCall
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme

/** In-app counterpart of the ringing notification (web `IncomingCallModal`): who is calling, Answer / Decline. */
@Composable
fun IncomingCallDialog(call: IncomingCall, onAnswer: () -> Unit, onDecline: () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Dialog(onDismissRequest = onDecline) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(c.chatCanvas)
                .border(1.dp, c.border, RoundedCornerShape(8.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            UserAvatar(call.callerId, size = 72.dp)
            Spacer(Modifier.height(16.dp))
            Text(call.callerName, color = c.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(4.dp))
            Text("is calling you…", color = c.textMuted, fontSize = 14.sp)
            Spacer(Modifier.height(24.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CallButton("Decline", NTDestructive, Modifier.weight(1f), onDecline)
                CallButton("Answer", NTPrimary, Modifier.weight(1f), onAnswer)
            }
        }
    }
}

@Composable
private fun CallButton(label: String, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(44.dp).clip(RoundedCornerShape(6.dp)).background(color).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium) }
}
