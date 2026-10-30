package com.cove.chat.ui.components

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
import com.cove.chat.ui.components.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.asImageBitmap
import com.cove.chat.data.remote.AvatarCache
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.LineHeightStyle
import com.cove.chat.ui.theme.ThemeSettings
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.MaterialTheme
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.CoveTheme

/** Same palette as `ChannelInitialsAvatar` in client-web/src/components/Avatar.tsx. */
private val ChannelPalette = listOf(
    0xFF5865F2, 0xFF57F287, 0xFFFEE75C, 0xFFEB459E, 0xFFED4245,
    0xFF3BA55C, 0xFFFAA61A, 0xFF9B59B6, 0xFF00B0F4, 0xFFE91E63
).map { Color(it) }

/** Port of the web `stringHash` (djb2-xor, int32 arithmetic like JS bitwise ops). */
private fun stringHash(s: String): Int {
    var h = 5381
    for (c in s) h = (h.toLong() * 33).toInt() xor c.code
    return kotlin.math.abs(h.toLong()).toInt().let { if (it < 0) Int.MAX_VALUE else it }
}

/**
 * Colored circle with the channel/DM initials, matching the web `ChannelInitialsAvatar` (first letters of up to two
 * words, same palette and font ratios). The text is positioned by its ink bounds, not its line box: Vazirmatn's tall
 * asymmetric ascent/descent otherwise leaves the glyphs visibly off-centre.
 */
@Composable
fun InitialsAvatar(id: String, name: String, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    val key = id.ifEmpty { name }
    val color = if (key.isEmpty()) ChannelPalette[0] else ChannelPalette[stringHash(key) % ChannelPalette.size]
    val text = name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercase() }.joinToString("").ifEmpty { "#" }
    val context = androidx.compose.ui.platform.LocalContext.current
    val typeface = remember {
        runCatching { androidx.core.content.res.ResourcesCompat.getFont(context, com.cove.chat.R.font.vazirmatn) }.getOrNull()
            ?.let { android.graphics.Typeface.create(it, android.graphics.Typeface.BOLD) } ?: android.graphics.Typeface.DEFAULT_BOLD
    }
    Canvas(modifier.size(size).clip(CircleShape).background(color)) {
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            this.color = android.graphics.Color.WHITE
            this.typeface = typeface
            textSize = this@Canvas.size.width * (if (text.length > 1) 0.38f else 0.44f)
        }
        val ink = android.graphics.Rect().also { paint.getTextBounds(text, 0, text.length, it) }
        val x = this.size.width / 2f - ink.exactCenterX()
        val y = this.size.height / 2f - ink.exactCenterY()
        drawContext.canvas.nativeCanvas.drawText(text, x, y, paint)
    }
}

/** A group's photo when it has one (cached after the first load), otherwise its coloured initials. */
@Composable
fun ChannelAvatar(id: String, name: String, avatarId: String?, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    if (!avatarId.isNullOrBlank()) {
        var photo by remember(avatarId) { mutableStateOf(AvatarCache.peek(avatarId)) }
        LaunchedEffect(avatarId) { if (photo == null) photo = AvatarCache.load(avatarId) }
        photo?.let {
            androidx.compose.foundation.Image(
                bitmap = it.asImageBitmap(), contentDescription = null,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = modifier.size(size).clip(CircleShape)
            )
            return
        }
    }
    InitialsAvatar(id, name, size, modifier)
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

/** Sentinel avatar id the server gives its built-in Cove account; drawn from the bundled brand mark. */
const val SYSTEM_AVATAR_ID = "system:cove"

/**
 * Profile photo when [avatarId] is set (loaded and cached from the server), otherwise the identicon.
 */
@Composable
fun UserAvatar(userId: String, size: Dp = 36.dp, modifier: Modifier = Modifier, avatarId: String? = null) {
    if (avatarId == SYSTEM_AVATAR_ID) {
        // The server's Cove account has no uploaded photo: show the brand mark on a white disc.
        androidx.compose.foundation.layout.Box(
            modifier.size(size).clip(CircleShape).background(Color.White),
            contentAlignment = androidx.compose.ui.Alignment.Center
        ) { CoveMark(size * 0.62f) }
        return
    }
    if (!avatarId.isNullOrBlank()) {
        var photo by remember(avatarId) { mutableStateOf(AvatarCache.peek(avatarId)) }
        LaunchedEffect(avatarId) { if (photo == null) photo = AvatarCache.load(avatarId) }
        photo?.let {
            androidx.compose.foundation.Image(
                bitmap = it.asImageBitmap(),
                contentDescription = null,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = modifier.size(size).clip(CircleShape)
            )
            return
        }
    }
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

/** Flips directional icons (back chevrons) when the UI is right-to-left. */
fun Modifier.mirrorInRtl(): Modifier = this.then(Modifier.graphicsLayer { scaleX = if (AppLanguage.isRtl) -1f else 1f })

/** Presence dot (green when online) drawn with a background-colored ring like the web avatar badge. */
@Composable
fun StatusDot(online: Boolean, size: Dp = 10.dp, ring: Color = CoveTheme.extendedColors.card) {
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
                    if (online) CoveTheme.extendedColors.statusOnline
                    else CoveTheme.extendedColors.statusOffline
                )
        )
    }
}

/** Red tinted error box (`bg-destructive/10 border-destructive/20`). */
@Composable
fun ErrorBanner(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(CoveShapes.md)
            .background(MaterialTheme.colorScheme.error.copy(alpha = 0.1f))
            .border(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.2f), CoveShapes.md)
            .padding(12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, color = MaterialTheme.colorScheme.error, fontSize = CoveType.label.fontSize, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** "Cove is open source / made with ❤️ by mjn" footer shown on every pre-login page. */
@Composable
fun OpenSourceFooter(modifier: Modifier = Modifier) {
    val muted = CoveTheme.extendedColors.textMuted.copy(alpha = 0.4f)
    Column(
        modifier = modifier.padding(bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text("COVE IS OPEN SOURCE", color = muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text(
            text = buildAnnotatedString {
                append("made with ❤️ by ")
                withStyle(SpanStyle(color = CoveTheme.extendedColors.textPrimary.copy(alpha = 0.4f))) { append("mjn") }
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
    Box(modifier.fillMaxWidth().height(1.dp).background(CoveTheme.extendedColors.border))
}

/** The bare Cove mark (speech bubble with two waves) with no tile or background, as on the web server-select page. */
@Composable
fun CoveMark(size: Dp = 64.dp, modifier: Modifier = Modifier) {
    androidx.compose.foundation.Image(
        painter = androidx.compose.ui.res.painterResource(com.cove.chat.R.drawable.ic_cove_mark),
        contentDescription = null, modifier = modifier.size(size)
    )
}
