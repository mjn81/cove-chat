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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
 * Message composer matching client-web `ChatInputArea` on a small screen (design-reference/24..27): a flat
 * `bg-secondary` box with a hairline border and 8dp radius, a translucent round "+" attachment button, a
 * borderless auto-growing text area and four plain 18dp outline icons (mic, video, emoji, send) on the right.
 * The reply banner sits flush on top, and the voice recorder takes over the row while recording.
 */
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
    val small = LocalConfiguration.current.screenWidthDp <= 400
    var menuOpen by remember { mutableStateOf(false) }
    var emojiOpen by remember { mutableStateOf(false) }
    val canSend = input.isNotBlank() && !uploading
    val shape = RoundedCornerShape(topStart = if (context != null) 0.dp else Radius.md, topEnd = if (context != null) 0.dp else Radius.md, bottomStart = Radius.md, bottomEnd = Radius.md)

    Column(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp)) {
        if (emojiOpen) {
            EmojiPanel(onPick = { onInputChange(input + it) }, onDismiss = { emojiOpen = false })
            Spacer(Modifier.height(6.dp))
        }
        context?.let { ReplyBanner(it, onCancelContext) }

        Column(
            Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape)
        ) {
            if (recording) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    CoveIconButton(Icons.Outlined.Delete, "Cancel recording", onCancelRecording, size = 26.dp, iconSize = 18.dp)
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.error))
                    Spacer(Modifier.width(8.dp))
                    Text("Recording  %d:%02d".format(elapsedSeconds / 60, elapsedSeconds % 60), color = c.textPrimary, fontSize = CoveType.label.fontSize, modifier = Modifier.weight(1f))
                    CoveIconButton(Icons.AutoMirrored.Outlined.Send, "Send voice message", onFinishRecording, tint = MaterialTheme.colorScheme.primary, size = 26.dp, iconSize = 18.dp, mirrorInRtl = true)
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(if (small) 8.dp else 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Box(Modifier.padding(top = 2.dp)) {
                        Box(
                            Modifier.size(20.dp).clip(CircleShape).background(c.textMuted.copy(alpha = 0.1f)).clickable(enabled = !uploading) { menuOpen = true },
                            contentAlignment = Alignment.Center
                        ) {
                            if (uploading) CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 2.dp, modifier = Modifier.size(12.dp))
                            else Icon(Icons.Outlined.Add, "Add attachment", tint = c.textMuted, modifier = Modifier.size(12.dp))
                        }
                        DropdownMenu(
                            expanded = menuOpen, onDismissRequest = { menuOpen = false },
                            shape = CoveShapes.lg, containerColor = c.popover
                        ) {
                            CoveListRow("Photo or Video", compact = true, contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm), leading = { Icon(Icons.Outlined.Image, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp)) }, onClick = { menuOpen = false; onPickMedia() })
                            CoveListRow("Audio", compact = true, contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm), leading = { Icon(Icons.Outlined.MusicNote, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp)) }, onClick = { menuOpen = false; onPickAudio() })
                            CoveListRow("Document / File", compact = true, contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.sm), leading = { Icon(Icons.Outlined.Description, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp)) }, onClick = { menuOpen = false; onPickFile() })
                        }
                    }

                    Box(Modifier.weight(1f).heightIn(min = 24.dp, max = 140.dp), contentAlignment = Alignment.CenterStart) {
                        if (input.isEmpty()) {
                            Text(
                                if (small) "Message..." else "Message $targetLabel",
                                color = c.textMuted.copy(alpha = 0.6f), fontSize = CoveType.body.fontSize, lineHeight = 24.sp, maxLines = 1
                            )
                        }
                        BasicTextField(
                            value = input,
                            onValueChange = onInputChange,
                            textStyle = TextStyle(
                                color = c.textPrimary, fontSize = CoveType.body.fontSize, lineHeight = 24.sp,
                                textDirection = TextDirection.Content,
                                lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(if (small) 2.dp else 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        CoveIconButton(Icons.Outlined.Mic, "Record voice message", onStartRecording, size = 26.dp, iconSize = 18.dp)
                        CoveIconButton(Icons.Outlined.Videocam, "Record video message", onVideo, size = 26.dp, iconSize = 18.dp)
                        CoveIconButton(Icons.Outlined.EmojiEmotions, "Add emoji", { emojiOpen = !emojiOpen }, size = 26.dp, iconSize = 18.dp)
                        CoveIconButton(Icons.AutoMirrored.Outlined.Send, "Send message", { if (canSend) onSend() }, enabled = canSend, size = 26.dp, iconSize = 18.dp, mirrorInRtl = true)
                    }
                }
            }
        }
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
