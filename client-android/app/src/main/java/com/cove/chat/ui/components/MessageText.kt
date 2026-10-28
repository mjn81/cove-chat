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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * A chat message body with tappable links/mentions (see [linkifiedText]) and web-style long-press copy: holding a link
 * copies that URL/email, holding anywhere else copies the whole message. Feedback is a haptic tick, a brief primary
 * flash over the text and a "Copied" pill that pops in above it.
 *
 * The long-press detector never consumes pointer events, so taps still reach links and the row's own click handler;
 * only the release after a *successful* long press is consumed so it does not also toggle the message selection.
 */
@Composable
fun MessageText(
    text: String,
    color: Color,
    fontSize: TextUnit,
    linkColor: Color,
    modifier: Modifier = Modifier,
    lineHeight: TextUnit = 22.sp,
    onMention: (username: String) -> Unit = {}
) {
    val c = CoveTheme.extendedColors
    val onMentionState = rememberUpdatedState(onMention)
    val body = remember(text, linkColor) { linkifiedText(text, linkColor) { onMentionState.value(it) } }
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
            .pointerInput(body, timeout) {
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
                        clipboard.setText(AnnotatedString(link ?: text))
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        copiedTick++
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
