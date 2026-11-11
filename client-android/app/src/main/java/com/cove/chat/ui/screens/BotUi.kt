package com.cove.chat.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.ArrowOutward
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.bots.BotButton
import com.cove.chat.bots.BotKeyboard
import com.cove.chat.bots.BotLogic
import com.cove.chat.bots.ChannelCommand
import com.cove.chat.ui.components.BotBadge
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.MessageText
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing

/**
 * The glass look of bot controls (Telegram-style inline keyboard): a translucent pill that sits on the bubble or the
 * chat background. The fill is a low-alpha wash of the theme's foreground (dark wash on light themes, light wash on
 * dark ones) over a faint top highlight, with a hairline low-alpha border. Pressing deepens the wash. Compose has no
 * cheap backdrop blur (Modifier.blur blurs the node's own content, not what is behind it), so the translucent layered
 * fill plus the hairline is the glass; it mirrors the web style `.bot-glass`. Only bot message buttons and the action
 * menu use it.
 */
@Composable
private fun glassFill(style: String, pressed: Boolean, active: Boolean): Brush {
    val scheme = MaterialTheme.colorScheme
    val wash = CoveTheme.extendedColors.textPrimary
    val base = when (style) {
        "primary" -> scheme.primary.copy(alpha = if (pressed) 0.46f else 0.26f)
        "danger" -> scheme.error.copy(alpha = if (pressed) 0.42f else 0.22f)
        else -> wash.copy(alpha = if (pressed) 0.22f else 0.10f)
    }
    val a = if (active) 1f else 0.5f
    val top = base.copy(alpha = base.alpha * a)
    val bottom = base.copy(alpha = base.alpha * a * 0.85f)
    return Brush.verticalGradient(listOf(top, bottom))
}

@Composable
private fun glassBorder(style: String): Color {
    val scheme = MaterialTheme.colorScheme
    return when (style) {
        "primary" -> scheme.primary.copy(alpha = 0.40f)
        "danger" -> scheme.error.copy(alpha = 0.40f)
        else -> CoveTheme.extendedColors.textPrimary.copy(alpha = 0.10f)
    }
}

/**
 * A grid of bot buttons in the glass style. Every row fills the width evenly (buttons share it equally, labels
 * ellipsize) with 4 dp gaps, like Telegram's inline keyboard. Callback buttons call [onPress] with their `custom_id`;
 * URL buttons open the link (http/https only) in the browser and show a small arrow-out icon. Every target is at
 * least 44 dp tall. [pendingId] shows a spinner and disables the button, [doneId] a check for a moment after the bot
 * received the press. [menu] only makes the buttons a little roomier (action menu).
 */
@Composable
fun BotButtonGrid(
    rows: List<List<BotButton>>,
    onPress: (customId: String) -> Unit,
    modifier: Modifier = Modifier,
    pendingId: String? = null,
    doneId: String? = null,
    enabled: Boolean = true,
    menu: Boolean = false
) {
    val context = LocalContext.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { b -> GlassButton(b, onPress, context, pendingId, doneId, enabled, menu, Modifier.weight(1f).fillMaxHeight()) }
            }
        }
    }
}

@Composable
private fun GlassButton(
    b: BotButton,
    onPress: (String) -> Unit,
    context: android.content.Context,
    pendingId: String?,
    doneId: String?,
    enabled: Boolean,
    menu: Boolean,
    modifier: Modifier
) {
    val c = CoveTheme.extendedColors
    val isLink = b.url != null
    val pending = !isLink && pendingId != null && pendingId == b.customId
    val done = !isLink && doneId != null && doneId == b.customId
    val active = enabled && !b.disabled && !pending
    val shape = RoundedCornerShape(10.dp)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier
            .heightIn(min = if (menu) 48.dp else 44.dp)
            .clip(shape)
            .background(glassFill(b.style, pressed && active, active || pending))
            .border(1.dp, glassBorder(b.style), shape)
            .clickable(interactionSource = interaction, indication = null, enabled = active) {
                if (isLink) {
                    val url = b.url.orEmpty()
                    if (BotLogic.isSafeButtonUrl(url)) {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                            .onFailure { I18nToast.make(context, "Couldn't open the link.", android.widget.Toast.LENGTH_SHORT).show() }
                    }
                } else b.customId?.let(onPress)
            }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (pending) {
            CircularProgressIndicator(strokeWidth = 2.dp, color = c.textPrimary, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
        } else if (done) {
            Icon(Icons.Outlined.Check, null, tint = c.success, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(
            b.label, color = if (b.disabled) c.textMuted else c.textPrimary, fontSize = CoveType.label.fontSize,
            fontWeight = FontWeight.Medium, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false)
        )
        if (isLink) {
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Outlined.ArrowOutward, "Opens a link", tint = c.textPrimary.copy(alpha = 0.7f), modifier = Modifier.size(14.dp))
        }
    }
}

/** A `bot` message: its text and its button grid. [onPress] gets the pressed button's `custom_id`. */
@Composable
fun BotMessageView(
    text: String,
    onPress: (customId: String) -> Unit,
    pendingId: String?,
    doneId: String?,
    modifier: Modifier = Modifier,
    onLongPress: () -> Unit = {}
) {
    val c = CoveTheme.extendedColors
    val body = remember(text) { BotLogic.parseBotMessage(text) }
    if (body == null) {
        Text("This message can't be shown.", color = c.textMuted, fontSize = CoveType.label.fontSize, modifier = modifier)
        return
    }
    Column(modifier) {
        if (body.text.isNotBlank()) {
            MessageText(
                body.text, color = c.textPrimary, fontSize = CoveType.body.fontSize, linkColor = MaterialTheme.colorScheme.primary,
                onMention = {}, onInvite = {}, onLongPress = onLongPress
            )
        }
        if (body.buttons.isNotEmpty()) {
            BotButtonGrid(body.buttons, onPress, Modifier.padding(top = 6.dp), pendingId = pendingId, doneId = doneId)
        }
    }
}

/**
 * The bot's action menu: a glass button grid that REPLACES the composer's input area (like a reply keyboard). The
 * header names the bot's prompt and carries the button that switches back to typing; the grid scrolls when tall.
 */
@Composable
fun ActionMenu(
    keyboard: BotKeyboard,
    onPress: (customId: String) -> Unit,
    onTyping: () -> Unit,
    pendingId: String?,
    modifier: Modifier = Modifier
) {
    val c = CoveTheme.extendedColors
    val scheme = MaterialTheme.colorScheme
    val shape = CoveShapes.md
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
            .clip(shape)
            .background(Brush.linearGradient(listOf(scheme.primary.copy(alpha = 0.10f), c.accent.copy(alpha = 0.25f))))
            .background(c.card.copy(alpha = 0.6f))
            .border(1.dp, c.border, shape)
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                keyboard.placeholder.ifBlank { "Choose an option" }, color = c.textMuted, fontSize = CoveType.caption.fontSize,
                fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f)
            )
            BotBadge()
            CoveIconButton(Icons.Outlined.Keyboard, "Type a message", onTyping, size = 44.dp, iconSize = 20.dp)
        }
        Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()).padding(start = 6.dp, end = 6.dp, bottom = 6.dp)) {
            BotButtonGrid(keyboard.rows, onPress, pendingId = pendingId, menu = true)
        }
    }
}

/** Slim strip above the composer that brings a persistent action menu back after the user switched to typing. */
@Composable
fun ActionMenuToggle(botName: String, onShow: () -> Unit, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    Row(
        modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClick = onShow).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.Keyboard, null, tint = c.textMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text("Show bot menu", color = c.textMuted, fontSize = CoveType.label.fontSize, fontWeight = FontWeight.Medium)
        if (botName.isNotBlank()) {
            Spacer(Modifier.width(8.dp))
            Text(botName, color = c.textMuted, fontSize = CoveType.caption.fontSize, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Command list shown above the composer while typing `/name`; tapping one inserts it. */
@Composable
fun SlashSuggestions(items: List<ChannelCommand>, onPick: (ChannelCommand) -> Unit, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clip(CoveShapes.md)
            .border(1.dp, c.border, CoveShapes.md)
            .background(c.popover)
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Terminal, null, tint = c.textMuted, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Commands", color = c.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            items.forEach { cmd ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { onPick(cmd) }.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    UserAvatar(cmd.botId, size = 28.dp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(BotLogic.usageLine(cmd), color = c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                            Spacer(Modifier.width(6.dp))
                            BotBadge()
                        }
                        Text("${cmd.botUsername} · ${cmd.description}", color = c.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}
