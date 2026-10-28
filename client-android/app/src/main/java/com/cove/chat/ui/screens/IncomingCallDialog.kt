package com.cove.chat.ui.screens

import androidx.compose.foundation.layout.size
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.DialogSize
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
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
import com.cove.chat.notify.IncomingCall
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveTheme

/** In-app counterpart of the ringing notification (web `IncomingCallModal`): who is calling, Answer / Decline. */
@Composable
fun IncomingCallDialog(call: IncomingCall, onAnswer: () -> Unit, onDecline: () -> Unit) {
    val c = CoveTheme.extendedColors
    CoveDialog(onDismiss = onDecline, size = DialogSize.Sm, showClose = false) {
        Column(Modifier.fillMaxWidth().padding(Spacing.xl), horizontalAlignment = Alignment.CenterHorizontally) {
            UserAvatar(call.callerId, size = 72.dp)
            Spacer(Modifier.height(Spacing.lg))
            Text(call.callerName, color = c.textPrimary, style = CoveType.title, textAlign = TextAlign.Center)
            Spacer(Modifier.height(Spacing.xs))
            Text("is calling you…", color = c.textMuted, style = CoveType.label, fontWeight = FontWeight.Normal)
            Spacer(Modifier.height(Spacing.xl))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                CoveButton("Decline", onDecline, Modifier.weight(1f), variant = ButtonVariant.Destructive, size = ButtonSize.Lg)
                CoveButton("Answer", onAnswer, Modifier.weight(1f), size = ButtonSize.Lg)
            }
        }
    }
}
