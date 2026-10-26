package com.nodetalk.client.ui.screens

import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Radius
import com.nodetalk.client.ui.components.CoveIconButton
import com.nodetalk.client.ui.components.CoveListRow
import com.nodetalk.client.ui.theme.Spacing
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.ui.components.AppLanguage
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.components.mirrorInRtl
import com.nodetalk.client.ui.theme.CoveTheme

/** What the reply/edit banner above the input shows. */
class InputContext(val isEdit: Boolean, val author: String, val snippet: String)


/**
 * Mobile-first message composer. Everything the web `ChatInputArea` offers is still here, but reorganised for one
 * hand: a large "+" opens a bottom sheet with big labelled actions (photo/video, audio, file, video message), the
 * text field carries the emoji toggle, and one trailing button is a mic while the field is empty (tap = hands-free
 * recording, hold = push-to-talk, slide towards the start edge = cancel, slide up = lock) and a send button once
 * there is text. All targets are 48dp, icons 24dp and text 16sp.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatInputBar(
    input: String,
    onInputChange: (String) -> Unit,
    targetLabel: String,
    context: InputContext?,
    onCancelContext: () -> Unit,
    uploading: Boolean,
    recording: Boolean,
    elapsedSeconds: Int,
    onSend: () -> Unit,
    onPickMedia: () -> Unit,
    onPickAudio: () -> Unit,
    onPickFile: () -> Unit,
    onStartRecording: () -> Unit,
    onCancelRecording: () -> Unit,
    onFinishRecording: () -> Unit,
    onVideo: () -> Unit
) {
    val c = CoveTheme.extendedColors
    val primary = MaterialTheme.colorScheme.primary
    var sheetOpen by remember { mutableStateOf(false) }
    var emojiOpen by remember { mutableStateOf(false) }
    var locked by remember { mutableStateOf(false) }
    var dragHint by remember { mutableStateOf(0f) } // 0..1: how close the hold gesture is to cancelling
    val hasText = input.isNotBlank()
    val canSend = hasText && !uploading
    val topRadius = if (context != null) 0.dp else Radius.md
    val fieldShape = RoundedCornerShape(topStart = topRadius, topEnd = topRadius, bottomStart = Radius.md, bottomEnd = Radius.md)
    val rtl = AppLanguage.isRtl
    LaunchedEffect(recording) { if (!recording) { locked = false; dragHint = 0f } }

    if (sheetOpen) {
        AttachmentSheet(
            listOf(
                AttachAction(Icons.Outlined.Image, "Photo or Video", onPickMedia),
                AttachAction(Icons.Outlined.MusicNote, "Audio", onPickAudio),
                AttachAction(Icons.Outlined.Description, "Document / File", onPickFile),
                AttachAction(Icons.Outlined.Videocam, "Video message", onVideo)
            ),
            container = c.popover, accent = primary, labelColor = c.textPrimary, onDismiss = { sheetOpen = false }
        )
    }

    Column(Modifier.fillMaxWidth().padding(start = Spacing.sm, end = Spacing.sm, top = Spacing.xs, bottom = Spacing.sm)) {
        if (emojiOpen && !recording) {
            EmojiPanel(onPick = { onInputChange(input + it) }, onDismiss = { emojiOpen = false })
            Spacer(Modifier.height(6.dp))
        }
        context?.let { ReplyBanner(it, onCancelContext) }

        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (recording && locked) {
                Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onCancelRecording), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Delete, "Cancel recording", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(26.dp))
                }
            } else if (!recording) {
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(c.textMuted.copy(alpha = 0.1f)).clickable(enabled = !uploading) { emojiOpen = false; sheetOpen = true },
                    contentAlignment = Alignment.Center
                ) {
                    if (uploading) CircularProgressIndicator(color = primary, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                    else Icon(Icons.Outlined.Add, "Add attachment", tint = c.textMuted, modifier = Modifier.size(28.dp))
                }
            }

            Row(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(fieldShape).background(c.card).border(1.dp, c.border, fieldShape),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (recording) {
                    Spacer(Modifier.width(Spacing.lg))
                    Box(Modifier.size(12.dp).clip(CircleShape).background(MaterialTheme.colorScheme.error))
                    Spacer(Modifier.width(Spacing.sm))
                    Text(mmss(elapsedSeconds), color = c.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.weight(1f))
                    if (!locked) {
                        Text(if (rtl) "Slide right to cancel" else "Slide left to cancel", color = c.textMuted.copy(alpha = 1f - dragHint * 0.6f), fontSize = 14.sp, maxLines = 1, modifier = Modifier.padding(end = Spacing.md))
                    } else {
                        Text("Recording", color = c.textMuted, fontSize = 14.sp, modifier = Modifier.padding(end = Spacing.md))
                    }
                } else {
                    Box(Modifier.weight(1f).padding(start = Spacing.lg, top = 12.dp, bottom = 12.dp).heightIn(max = 140.dp), contentAlignment = Alignment.CenterStart) {
                        if (input.isEmpty()) {
                            Text("Message $targetLabel", color = c.textMuted.copy(alpha = 0.7f), fontSize = 16.sp, lineHeight = 24.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        BasicTextField(
                            value = input,
                            onValueChange = onInputChange,
                            textStyle = TextStyle(
                                color = c.textPrimary, fontSize = 16.sp, lineHeight = 24.sp, textDirection = TextDirection.Content,
                                lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
                            ),
                            cursorBrush = SolidColor(primary),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    CoveIconButton(
                        Icons.Outlined.EmojiEmotions, "Add emoji", { emojiOpen = !emojiOpen },
                        tint = if (emojiOpen) primary else c.textMuted, size = 48.dp, iconSize = 24.dp
                    )
                }
            }

            // One trailing button: send when there is text (or while a locked recording is running), mic otherwise.
            val showSend = hasText || (recording && locked)
            if (showSend) {
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(if (canSend || recording) primary else c.textMuted.copy(alpha = 0.2f))
                        .clickable(enabled = canSend || recording) { if (recording) onFinishRecording() else onSend() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Send, if (recording) "Send voice message" else "Send message", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp).mirrorInRtl())
                }
            } else {
                MicButton(
                    enabled = !uploading, recording = recording, rtl = rtl,
                    onStart = { emojiOpen = false; onStartRecording() },
                    onCancel = onCancelRecording, onFinish = onFinishRecording,
                    onLock = { locked = true }, onDrag = { dragHint = it }
                )
            }
        }
    }
}

/**
 * Mic button with the gesture state machine: press starts recording; releasing after a long press sends it,
 * releasing after a short tap locks it hands-free, dragging towards the start edge past 80dp cancels, dragging
 * up past 64dp locks.
 */
@Composable
private fun MicButton(
    enabled: Boolean, recording: Boolean, rtl: Boolean,
    onStart: () -> Unit, onCancel: () -> Unit, onFinish: () -> Unit, onLock: () -> Unit, onDrag: (Float) -> Unit
) {
    val primary = MaterialTheme.colorScheme.primary
    val density = LocalDensity.current
    val cancelPx = with(density) { 80.dp.toPx() }
    val lockPx = with(density) { 64.dp.toPx() }
    val currentEnabled by rememberUpdatedState(enabled)
    val start by rememberUpdatedState(onStart)
    val cancel by rememberUpdatedState(onCancel)
    val finish by rememberUpdatedState(onFinish)
    val lock by rememberUpdatedState(onLock)
    val drag by rememberUpdatedState(onDrag)
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(if (recording) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Transparent)
            .pointerInput(rtl, cancelPx, lockPx) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    if (!currentEnabled) return@awaitEachGesture
                    down.consume()
                    start()
                    val t0 = System.currentTimeMillis()
                    var resolved = false
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        val dx = ch.position.x - down.position.x
                        val dy = ch.position.y - down.position.y
                        val towardsCancel = if (rtl) dx else -dx
                        drag((towardsCancel / cancelPx).coerceIn(0f, 1f))
                        if (!resolved && towardsCancel > cancelPx) { resolved = true; cancel(); drag(0f) }
                        else if (!resolved && -dy > lockPx) { resolved = true; lock(); drag(0f) }
                        ch.consume()
                        if (!ch.pressed) break
                    }
                    if (!resolved) {
                        // A quick tap leaves the recorder running hands-free; a held press is push-to-talk.
                        if (System.currentTimeMillis() - t0 < 350) lock() else finish()
                        drag(0f)
                    }
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Outlined.Mic, "Record voice message", tint = if (recording) MaterialTheme.colorScheme.onError else CoveTheme.extendedColors.textMuted, modifier = Modifier.size(24.dp))
    }
}

/** "Replying to **name**  | snippet" banner that sits flush on the composer (web `Reply Preview`). */
@Composable
private fun ReplyBanner(ctx: InputContext, onCancel: () -> Unit) {
    val c = CoveTheme.extendedColors
    val shape = RoundedCornerShape(topStart = Radius.md, topEnd = Radius.md)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.AutoMirrored.Outlined.Reply, null, tint = c.textMuted, modifier = Modifier.size(14.dp).mirrorInRtl())
        Spacer(Modifier.width(8.dp))
        if (ctx.isEdit) {
            Text("Editing message", color = c.textMuted, fontSize = CoveType.label.fontSize)
        } else {
            Text("Replying to ", color = c.textMuted, fontSize = CoveType.label.fontSize, maxLines = 1)
            Text(ctx.author, color = c.textPrimary, fontSize = CoveType.label.fontSize, fontWeight = FontWeight.Bold, maxLines = 1)
        }
        Spacer(Modifier.width(8.dp))
        Box(Modifier.width(1.dp).height(14.dp).background(c.border))
        Spacer(Modifier.width(8.dp))
        Text(ctx.snippet, color = c.textMuted.copy(alpha = 0.7f), fontSize = CoveType.label.fontSize, fontStyle = FontStyle.Italic, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Box(Modifier.size(24.dp).clip(CircleShape).clickable(onClick = onCancel), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Close, "Cancel", tint = c.textMuted, modifier = Modifier.size(14.dp))
        }
    }
}

private class EmojiCategory(val icon: String, val emojis: List<String>)

private val EmojiCategories = listOf(
    EmojiCategory("😀", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖".split(" ")),
    EmojiCategory("👍", "👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 ✍️ 💪 🙌 👏 🤲 👐 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝".split(" ")),
    EmojiCategory("🐶", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐘 🦒 🌵 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🌸 🌼 🌻 🌞 🌙 ⭐ 🌈 ☁️ ⚡ 🔥 💧".split(" ")),
    EmojiCategory("🍔", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥦 🍄 🥜 🍞 🥐 🥖 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍲 🍣 🍤 🍙 🍚 🍦 🍩 🍪 🎂 🍰 🍫 🍬 🍭 ☕ 🍵 🍺 🍻 🥂 🍷 🥃 🍸".split(" ")),
    EmojiCategory("⚽", "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥅 🏒 🏏 ⛳ 🏹 🎣 🥊 🥋 ⛸️ 🎿 🏂 🏋️ 🤸 🏆 🥇 🥈 🥉 🎮 🎲 🎯 🎳 🎸 🎹 🎺 🎻 🎬 🎤 🎧 🎨 🎭".split(" ")),
    EmojiCategory("🚗", "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚚 🚜 🏍️ 🚲 ✈️ 🚀 🛸 🚁 ⛵ 🚤 🚢 🚂 🚇 🏠 🏢 🏥 🏫 🏰 ⛪ 🗼 🗽 🌉 🌅 🌃 🏖️ 🏝️ 🏔️ 🌋".split(" ")),
    EmojiCategory("💡", "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 💾 📷 📹 🎥 📞 📺 📻 ⏰ 🔋 💡 🔦 💰 💳 💎 🔧 🔨 ⚙️ 🔒 🔓 🔑 📦 ✉️ 📝 📅 📌 📎 ✂️ 📚 🔬 🔭 💊 🧰".split(" ")),
    EmojiCategory("🔣", "❤️ 💯 ✅ ❌ ⭕ ❗ ❓ ‼️ ⚠️ 🚫 ♻️ ➕ ➖ ➗ ✖️ ♾️ 💲 ™️ ©️ ®️ 🔔 🔕 🔊 🔇 ▶️ ⏸️ ⏹️ ⏩ ⏪ 🔀 🔁 ⬆️ ⬇️ ⬅️ ➡️ 🔴 🟠 🟡 🟢 🔵 🟣".split(" "))
)

/** Compact emoji picker (web uses emoji-mart): category tabs along the bottom and a 9-column grid. */
@Composable
private fun EmojiPanel(onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val c = CoveTheme.extendedColors
    var selected by remember { mutableStateOf(0) }
    Column(
        Modifier.fillMaxWidth().clip(CoveShapes.lg).background(c.popover).border(1.dp, c.border, CoveShapes.lg)
    ) {
        LazyVerticalGrid(columns = GridCells.Fixed(8), modifier = Modifier.fillMaxWidth().height(220.dp).padding(8.dp)) {
            items(EmojiCategories[selected].emojis) { e ->
                Box(Modifier.size(40.dp).clickable { onPick(e) }, contentAlignment = Alignment.Center) { androidx.compose.material3.Text(e, fontSize = 24.sp) }
            }
        }
        Row(Modifier.fillMaxWidth().border(1.dp, c.border).padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            EmojiCategories.forEachIndexed { i, cat ->
                Box(
                    Modifier.weight(1f).height(40.dp).clickable { selected = i }
                        .background(if (i == selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f) else androidx.compose.ui.graphics.Color.Transparent),
                    contentAlignment = Alignment.Center
                ) { androidx.compose.material3.Text(cat.icon, fontSize = CoveType.title.fontSize, modifier = Modifier.alpha(if (i == selected) 1f else 0.6f)) }
            }
            Box(Modifier.size(40.dp).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, "Close", tint = c.textMuted, modifier = Modifier.size(16.dp))
            }
        }
    }
}
