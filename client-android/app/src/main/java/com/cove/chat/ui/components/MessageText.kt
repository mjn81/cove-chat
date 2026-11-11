package com.cove.chat.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventTimeoutCancellationException
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * A chat message: Markdown text (bold/italic/strike, inline code, links, mentions), fenced code blocks with a copy
 * button and quotes. A plain message is a single text block and behaves exactly as before; see [MessageTextBody] for
 * the link/long-press behaviour of each text block.
 */
@Composable
fun MessageText(
    text: String,
    color: Color,
    fontSize: TextUnit,
    linkColor: Color,
    modifier: Modifier = Modifier,
    lineHeight: TextUnit = 22.sp,
    onMention: (username: String) -> Unit = {},
    onInvite: ((code: String) -> Unit)? = null,
    onLongPress: (() -> Unit)? = null
) {
    val blocks = remember(text) { parseMarkdown(text, MdMode.Chat) }
    MessageBlocks(blocks, text, color, fontSize, linkColor, modifier, lineHeight, onMention, onInvite, onLongPress)
}

@Composable
private fun MessageBlocks(
    blocks: List<MdBlock>, text: String, color: Color, fontSize: TextUnit, linkColor: Color, modifier: Modifier,
    lineHeight: TextUnit, onMention: (String) -> Unit, onInvite: ((String) -> Unit)?, onLongPress: (() -> Unit)?
) {
    val c = CoveTheme.extendedColors
    val single = blocks.singleOrNull()
    if (blocks.isEmpty() || single is MdBlock.Text) {
        val nodes = (single as? MdBlock.Text)?.children ?: listOf(MdInline.Text(text))
        MessageTextBody(text, nodes, color, fontSize, linkColor, modifier, lineHeight, onMention, onInvite, onLongPress)
        return
    }
    androidx.compose.foundation.layout.Column(modifier, verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(4.dp)) {
        for (b in blocks) when (b) {
            is MdBlock.Text -> MessageTextBody(text, b.children, color, fontSize, linkColor, Modifier, lineHeight, onMention, onInvite, onLongPress)
            is MdBlock.Code -> MdCodeBlock(b.value, b.lang, color, fontSize)
            is MdBlock.Quote -> Row(Modifier.height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(linkColor.copy(alpha = 0.6f)))
                MessageBlocks(b.children, text, color.copy(alpha = 0.85f), fontSize, linkColor, Modifier.padding(start = 10.dp), lineHeight, onMention, onInvite, onLongPress)
            }
            else -> Unit // headings, lists and rules are only produced in document mode
        }
    }
}

/**
 * A chat message body with tappable links/mentions (see [linkifiedText]) and web-style long-press copy: holding a link
 * copies that URL/email, holding anywhere else copies the whole message. Feedback is a haptic tick, a brief primary
 * flash over the text and a "Copied" pill that pops in above it.
 *
 * The long-press detector never consumes pointer events, so taps still reach links and the row's own click handler;
 * only the release after a *successful* long press is consumed so it does not also toggle the message selection.
 */
@Composable
private fun MessageTextBody(
    text: String,
    nodes: List<MdInline>,
    color: Color,
    fontSize: TextUnit,
    linkColor: Color,
    modifier: Modifier = Modifier,
    lineHeight: TextUnit = 22.sp,
    onMention: (username: String) -> Unit = {},
    onInvite: ((code: String) -> Unit)? = null,
    onLongPress: (() -> Unit)? = null
) {
    val c = CoveTheme.extendedColors
    val onMentionState = rememberUpdatedState(onMention)
    val onInviteState = rememberUpdatedState(onInvite)
    // Emoji become inline sprites; rebuilt when the style, its index or the custom emoji set changes.
    val emojiEpoch = com.cove.chat.emoji.EmojiEngine.epoch
    val inline = remember(text, fontSize, emojiEpoch) { com.cove.chat.emoji.EmojiInline(fontSize, com.cove.chat.emoji.EmojiText.SCALE_MESSAGE) }
    val codeBackground = c.card
    val body = remember(nodes, linkColor, onInvite != null, inline) {
        buildAnnotatedString {
            appendInlines(nodes, linkColor, codeBackground, { onMentionState.value(it) }, if (onInvite != null) ({ code -> onInviteState.value?.invoke(code) }) else null, inline)
        }
    }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val clipboard = LocalClipboardManager.current
    val haptic = LocalHapticFeedback.current
    val timeout = LocalViewConfiguration.current.longPressTimeoutMillis
    val flash = remember { Animatable(0f) }
    var copiedTick by remember { mutableIntStateOf(0) }
    var showPill by remember { mutableStateOf(false) }

    LaunchedEffect(copiedTick) {
        if (copiedTick == 0) return@LaunchedEffect
        showPill = true
        flash.snapTo(1f)
        launch { flash.animateTo(0f, tween(900)) }
        delay(1400)
        showPill = false
    }

    val shape = RoundedCornerShape(4.dp)
    Box(
        modifier
            .drawBehind { drawRoundRect(linkColor.copy(alpha = 0.28f * flash.value), cornerRadius = CornerRadius(4.dp.toPx())) }
            .pointerInput(body, timeout, onLongPress != null) {
                // Observed in the Initial pass (parent first) so the release after a long press can be consumed before the
                // text's own link handler turns it into a click; nothing is consumed unless a long press actually fires.
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    val slop = viewConfiguration.touchSlop
                    val longPressed = try {
                        withTimeout(timeout) {
                            while (true) {
                                val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: return@withTimeout
                                if (change.changedToUp() || (change.position - down.position).getDistance() > slop) return@withTimeout
                            }
                        }
                        false
                    } catch (_: PointerEventTimeoutCancellationException) {
                        true
                    }
                    if (longPressed) {
                        val offset = layout?.getOffsetForPosition(down.position) ?: -1
                        val link = if (offset >= 0) body.linkAt(offset) else null
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        if (onLongPress != null && link == null) {
                            // Holding the text starts message selection (copy lives in the selection bar); links still copy.
                            onLongPress()
                        } else {
                            clipboard.setText(AnnotatedString(link ?: text))
                            copiedTick++
                        }
                        while (true) {
                            val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: break
                            change.consume()
                            if (!change.pressed) break
                        }
                    }
                }
            }
    ) {
        androidx.compose.material3.Text(
            text = body, color = color, fontSize = fontSize, lineHeight = lineHeight,
            inlineContent = inline.content,
            onTextLayout = { layout = it }
        )
        AnimatedVisibility(
            visible = showPill,
            modifier = Modifier.align(Alignment.TopEnd).offset(y = (-30).dp),
            enter = fadeIn(tween(120)) + scaleIn(tween(180), initialScale = 0.8f) + slideInVertically(tween(180)) { it / 2 },
            exit = fadeOut(tween(220)) + slideOutVertically(tween(220)) { -it / 2 }
        ) {
            Row(
                Modifier.clip(shape).background(c.popover).border(1.dp, c.border, shape).padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.Check, null, tint = c.success, modifier = Modifier.size(14.dp))
                Text("Copied", color = c.textPrimary, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
            }
        }
    }
}

/** The URL/email under character [offset], without the `mailto:` prefix, or null when it is not on a link. */
private fun AnnotatedString.linkAt(offset: Int): String? =
    getLinkAnnotations(offset, offset + 1).firstNotNullOfOrNull { (it.item as? LinkAnnotation.Url)?.url?.removePrefix("mailto:") }
