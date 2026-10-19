package com.nodetalk.client.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.LineHeightStyle
import com.nodetalk.client.ui.theme.ThemeSettings
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NTPrimaryForeground
import com.nodetalk.client.ui.theme.NodeTalkTheme

/** Same palette as `ChannelInitialsAvatar` in client-web/src/components/Avatar.tsx. */
private val ChannelPalette = listOf(
    0xFF5865F2, 0xFF57F287, 0xFFFEE75C, 0xFFEB459E, 0xFFED4245,
    0xFF3BA55C, 0xFFFAA61A, 0xFF9B59B6, 0xFF00B0F4, 0xFFE91E63
).map { Color(it) }

/** Port of the web `stringHash` (djb2-xor, int32 arithmetic like JS bitwise ops). */
private fun stringHash(s: String): Int {
    var h = 5381
    for (c in s) h = (h.toLong() * 33).toInt() xor c.code
    return if (h == Int.MIN_VALUE) Int.MAX_VALUE else kotlin.math.abs(h)
}

/** Colored circle with the channel/DM initial, matching the web `ChannelInitialsAvatar`. */
@Composable
fun InitialsAvatar(id: String, name: String, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    val color = ChannelPalette[stringHash(id) % ChannelPalette.size]
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(color),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = name.trim().firstOrNull()?.uppercase() ?: "#",
            color = Color.White,
            fontSize = (size.value * 0.45f).sp,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * Exact port of `minidenticon(seed, 80, 50)` (minidenticons 4.2.1) as used by client-web `Avatar`,
 * so a user gets the same pattern and colour on web and mobile.
 */
private fun miniHash(seed: String): Long {
    var h = 5L
    for (ch in seed) h = (h.toInt() xor ch.code).toLong() * -5L
    return (h and 0xFFFFFFFFL) shr 2
}

@Composable
fun UserAvatar(userId: String, size: Dp = 36.dp, modifier: Modifier = Modifier) {
    val hash = miniHash(userId)
    val color = Color.hsl(((hash % 9) * 40).toFloat(), 0.8f, 0.5f)
    Canvas(modifier = modifier.size(size).clip(CircleShape)) {
        // The SVG viewBox is -1.5..6.5 (8 units) around a 5x5 grid of 1-unit cells.
        val unit = this.size.width / 8f
        for (i in 0 until 25) {
            if ((hash and (1L shl (i % 15))) == 0L) continue
            val x = if (i > 14) 7 - i / 5 else i / 5
            val y = i % 5
            drawRect(color, Offset((x + 1.5f) * unit, (y + 1.5f) * unit), Size(unit, unit))
        }
    }
}

/** Presence dot (green when online) drawn with a background-colored ring like the web avatar badge. */
@Composable
fun StatusDot(online: Boolean, size: Dp = 10.dp, ring: Color = NodeTalkTheme.extendedColors.card) {
    Box(
        Modifier
            .size(size + 4.dp)
            .clip(CircleShape)
            .background(ring),
        contentAlignment = Alignment.Center
    ) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(
                    if (online) NodeTalkTheme.extendedColors.statusOnline
                    else NodeTalkTheme.extendedColors.statusOffline
                )
        )
    }
}

/** Uppercase small label; [required] appends the red ` *` marker (web rule for required fields). */
@Composable
fun FieldLabel(text: String, required: Boolean = false) {
    Text(
        text = buildAnnotatedString {
            append(text.uppercase())
            if (required) withStyle(SpanStyle(color = NTDestructive)) { append(" *") }
        },
        color = NodeTalkTheme.extendedColors.textMuted,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold
    )
}

/** Flat dark input (`bg-popover`, 40dp, radius 8) used on every form, optional trailing icon slot. */
@Composable
fun NTTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    revealed: Boolean = false,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    height: Dp = 40.dp
) {
    val c = NodeTalkTheme.extendedColors
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = singleLine,
        textStyle = TextStyle(
            color = c.textPrimary, fontSize = 15.sp, lineHeight = 20.sp,
            lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
        ),
        cursorBrush = SolidColor(NTPrimary),
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = if (password && !revealed) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = modifier
            .fillMaxWidth()
            .height(height),
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(height)
                    .clip(RoundedCornerShape(8.dp))
                    // In light mode popover == background, so inputs use the card tone plus a hairline border to stay visible.
                    .background(if (ThemeSettings.dark) c.popover else c.card)
                    .border(1.dp, if (ThemeSettings.dark) c.popover else c.border, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                leading?.let {
                    it()
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(placeholder, color = c.textMuted, fontSize = 15.sp, lineHeight = 20.sp, maxLines = 1)
                    }
                    inner()
                }
                trailing?.invoke()
            }
        }
    )
}

/** Primary 44dp button (`bg-primary`, radius 8) with spinner state. */
@Composable
fun NTPrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, loading: Boolean = false, enabled: Boolean = true) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier
            .fillMaxWidth()
            .height(44.dp),
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = NTPrimary,
            contentColor = NTPrimaryForeground,
            disabledContainerColor = NTPrimary.copy(alpha = 0.5f),
            disabledContentColor = NTPrimaryForeground.copy(alpha = 0.5f)
        )
    ) {
        if (loading) {
            CircularProgressIndicator(color = NTPrimaryForeground, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
            Text(text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
}

/** Red tinted error box (`bg-destructive/10 border-destructive/20`). */
@Composable
fun ErrorBanner(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(NTDestructive.copy(alpha = 0.1f))
            .border(1.dp, NTDestructive.copy(alpha = 0.2f), RoundedCornerShape(6.dp))
            .padding(12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, color = NTDestructive, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** "NodeTalk is open source / made with ❤️ by mjn" footer shown on every pre-login page. */
@Composable
fun OpenSourceFooter(modifier: Modifier = Modifier) {
    val muted = NodeTalkTheme.extendedColors.textMuted.copy(alpha = 0.4f)
    Column(
        modifier = modifier.padding(bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text("NODETALK IS OPEN SOURCE", color = muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text(
            text = buildAnnotatedString {
                append("made with ❤️ by ")
                withStyle(SpanStyle(color = NodeTalkTheme.extendedColors.textPrimary.copy(alpha = 0.4f))) { append("mjn") }
            },
            color = muted,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

/** Convenience for rows that fill the width with equal padding. */
@Composable
fun SectionDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(NodeTalkTheme.extendedColors.border))
}
