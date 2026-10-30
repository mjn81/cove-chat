package com.cove.chat.ui.screens

import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Radius
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.CoveListRow
import com.cove.chat.ui.theme.Spacing
import androidx.compose.material3.MaterialTheme
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import android.os.SystemClock
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.produceState
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.RepeatMode
import com.cove.chat.CoveApp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.draw.rotate
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.animation.togetherWith
import androidx.compose.animation.scaleOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.AnimatedContent
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.expandVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.AnimatedVisibility
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
import com.cove.chat.ui.components.AppLanguage
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.mirrorInRtl
import com.cove.chat.ui.theme.CoveTheme

/** What the reply/edit banner above the input shows. [messageId] lets a tap on the banner jump to the original. */
class InputContext(val isEdit: Boolean, val author: String, val snippet: String, val messageId: String? = null)


/**
 * Colours of a composer. The main chat uses the app theme ([chatComposerPalette]); Whisper passes its own darker
 * palette so both chats share one component and stay visually consistent.
 */
class ComposerPalette(
    val card: Color, val border: Color, val focusBorder: Color, val text: Color, val muted: Color,
    val accent: Color, val onAccent: Color, val popover: Color
)

/** The main chat's palette, derived from the active theme. */
@Composable
fun chatComposerPalette(): ComposerPalette {
    val c = CoveTheme.extendedColors
    val primary = MaterialTheme.colorScheme.primary
    return ComposerPalette(c.card, c.border, primary.copy(alpha = 0.7f), c.textPrimary, c.textMuted, primary, MaterialTheme.colorScheme.onPrimary, c.popover)
}

private val FieldShape = RoundedCornerShape(24.dp)

/**
 * Telegram-style message composer shared by the chat and Whisper. One rounded pill holds the reply strip, the emoji
 * toggle, the text and the attach button; a separate round button on its end is a mic while the field is empty (hold
 * = push-to-talk, slide towards the start edge = cancel, slide up = lock, short tap = hands-free) and a send
 * button once there is text, swapping with a short scale animation. The emoji panel replaces the keyboard instead of
 * stacking with it, at the keyboard's own height so the layout does not jump. Emoji insert at the cursor and the
 * most recent ones are remembered.
 *
 * @param placeholder hint text; defaults to "Message <targetLabel>".
 * @param onAttach when set, the paperclip calls it instead of opening the built-in attachment sheet (Whisper has its own).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatInputBar(
    input: String,
    onInputChange: (String) -> Unit,
    targetLabel: String,
    context: InputContext?,
    onCancelContext: () -> Unit,
    onJumpToContext: () -> Unit = {},
    uploading: Boolean,
    recording: Boolean,
    elapsedSeconds: Int,
    onSend: () -> Unit,
    onPickMedia: () -> Unit = {},
    onPickAudio: () -> Unit = {},
    onPickFile: () -> Unit = {},
    onStartRecording: () -> Unit,
    onCancelRecording: () -> Unit,
    onFinishRecording: () -> Unit,
    onVideo: () -> Unit = {},
    onStopRecording: (() -> Unit)? = null,
    liveLevels: List<Int> = emptyList(),
    pendingVoice: VoiceRecorder.Result? = null,
    onSendPendingVoice: (VoiceRecorder.Result) -> Unit = {},
    onDiscardPendingVoice: () -> Unit = {},
    palette: ComposerPalette = chatComposerPalette(),
    placeholder: String = "Message $targetLabel",
    onAttach: (() -> Unit)? = null
) {
    val c = CoveTheme.extendedColors
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val keyboard = LocalSoftwareKeyboardController.current
    val prefs = CoveApp.instance.preferencesManager
    var sheetOpen by remember { mutableStateOf(false) }
    var emojiOpen by remember { mutableStateOf(false) }
    var locked by remember { mutableStateOf(false) }
    var dragHint by remember { mutableStateOf(0f) } // 0..1: how close the hold gesture is to cancelling
    var focused by remember { mutableStateOf(false) }
    var lockHint by remember { mutableStateOf(0f) } // 0..1: how far the mic has been slid up towards locking
    var discarding by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val discardT by animateFloatAsState(if (discarding) 1f else 0f, tween(280), label = "discard")
    var recents by remember { mutableStateOf(prefs.recentEmojis.split(" ").filter { it.isNotBlank() }) }
    // The field keeps its own selection so emoji land at the cursor; the parent still owns the plain text.
    var field by remember { mutableStateOf(TextFieldValue(input)) }
    LaunchedEffect(input) { if (input != field.text) field = TextFieldValue(input, TextRange(input.length)) }

    // Remember the keyboard's height so the emoji panel can take exactly its place.
    val imeBottom = WindowInsets.ime.getBottom(density)
    var keyboardDp by rememberSaveable { mutableStateOf(280f) }
    LaunchedEffect(imeBottom) { if (imeBottom > 0) keyboardDp = with(density) { imeBottom.toDp().value }.coerceIn(220f, 420f) }

    val hasText = input.isNotBlank()
    val canSend = hasText && !uploading
    val rtl = AppLanguage.isRtl
    val borderColor by animateColorAsState(if (focused) palette.focusBorder else palette.border, tween(150), label = "composerBorder")
    LaunchedEffect(recording) { if (!recording) { locked = false; dragHint = 0f; lockHint = 0f } }

    // Cancel plays a short shrink-and-fade (the recording collapses away) before the recording is dropped.
    fun cancelAnimated() {
        if (discarding) return
        discarding = true
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch { delay(300); onCancelRecording(); discarding = false }
    }

    fun insert(s: String) {
        val sel = field.selection
        val text = field.text.replaceRange(sel.min, sel.max, s)
        field = TextFieldValue(text, TextRange(sel.min + s.length))
        onInputChange(text)
        recents = (listOf(s) + recents.filter { it != s }).take(24)
        prefs.recentEmojis = recents.joinToString(" ")
    }

    if (sheetOpen) {
        AttachmentSheet(
            listOf(
                AttachAction(Icons.Outlined.Image, "Photo or Video", Color(0xFF6EA8F0), onPickMedia),
                AttachAction(Icons.Outlined.MusicNote, "Audio", Color(0xFFEC86AE), onPickAudio),
                AttachAction(Icons.Outlined.Description, "Document / File", Color(0xFF4FC9BA), onPickFile),
                AttachAction(Icons.Outlined.Videocam, "Video message", Color(0xFFA594F9), onVideo)
            ),
            container = palette.popover, accent = palette.accent, labelColor = palette.text, onDismiss = { sheetOpen = false }
        )
    }

    Column(Modifier.fillMaxWidth().padding(start = Spacing.sm, end = Spacing.sm, top = Spacing.xs, bottom = Spacing.sm)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Column(
                Modifier.weight(1f).clip(FieldShape).background(palette.card).border(1.dp, borderColor, FieldShape).animateContentSize(tween(150))
            ) {
                // Keep the last context while the strip animates out, otherwise its text would vanish before it collapses.
                var lastContext by remember { mutableStateOf(context) }
                if (context != null) lastContext = context
                AnimatedVisibility(
                    visible = context != null,
                    enter = expandVertically(tween(200)) + fadeIn(tween(200)),
                    exit = shrinkVertically(tween(160)) + fadeOut(tween(120))
                ) {
                    lastContext?.let { ReplyBanner(it, palette, onCancelContext, onJumpToContext) }
                }

                Row(verticalAlignment = Alignment.Bottom) {
                    if (pendingVoice != null) {
                        VoicePreview(pendingVoice, palette, onDiscardPendingVoice, onSendPendingVoice)
                    } else if (recording) {
                        RecordingRow(palette, locked, rtl, dragHint, discardT, liveLevels, ::cancelAnimated, onStopRecording, Modifier.weight(1f))
                    } else {
                        CoveIconButton(
                            if (emojiOpen) Icons.Outlined.Keyboard else Icons.Outlined.EmojiEmotions, if (emojiOpen) "Show keyboard" else "Add emoji",
                            { if (emojiOpen) { emojiOpen = false; keyboard?.show() } else { emojiOpen = true; keyboard?.hide() } },
                            tint = if (emojiOpen) palette.accent else palette.muted, size = 48.dp, iconSize = 24.dp
                        )
                        Box(Modifier.weight(1f).padding(vertical = 12.dp).heightIn(max = 150.dp), contentAlignment = Alignment.CenterStart) {
                            if (field.text.isEmpty()) {
                                Text(placeholder, color = palette.muted.copy(alpha = 0.7f), fontSize = 16.sp, lineHeight = 24.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            val press = remember { MutableInteractionSource() }
                            // Tapping the field while the emoji panel is open hands the space back to the keyboard.
                            LaunchedEffect(press) { press.interactions.collect { if (it is PressInteraction.Press) emojiOpen = false } }
                            BasicTextField(
                                value = field,
                                onValueChange = { field = it; if (it.text != input) onInputChange(it.text) },
                                textStyle = TextStyle(
                                    color = palette.text, fontSize = 16.sp, lineHeight = 24.sp, textDirection = TextDirection.Content,
                                    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
                                ),
                                cursorBrush = SolidColor(palette.accent),
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                                maxLines = 6,
                                interactionSource = press,
                                modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }
                            )
                        }
                        Box(Modifier.size(48.dp).clip(CircleShape).clickable(enabled = !uploading) {
                            emojiOpen = false
                            if (onAttach != null) onAttach() else sheetOpen = true
                        }, contentAlignment = Alignment.Center) {
                            if (uploading) CircularProgressIndicator(color = palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                            else Icon(Icons.Outlined.AttachFile, "Add attachment", tint = palette.muted, modifier = Modifier.size(24.dp).rotate(45f))
                        }
                    }
                }
            }

            // One trailing button: send when there is text (or while a locked recording is running), mic otherwise.
            val showSend = hasText || (recording && locked)
            if (pendingVoice == null) Box(contentAlignment = Alignment.Center) {
                val sendT by animateFloatAsState(if (showSend) 1f else 0f, tween(160), label = "micSendSwap")
                // The mic stays composed for the whole gesture. Swapping it out when the recording locks would cancel
                // the drag under the finger, and a clipping container (AnimatedContent) cut off the part of the mic
                // that follows the finger outside its 48dp slot, which is what made it look misplaced.
                Box(Modifier.graphicsLayer { alpha = 1f - sendT; scaleX = 1f - 0.5f * sendT; scaleY = 1f - 0.5f * sendT }) {
                    MicButton(
                        enabled = !uploading && !showSend, recording = recording, rtl = rtl, palette = palette,
                        onStart = { emojiOpen = false; haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onStartRecording() },
                        onCancel = ::cancelAnimated, onFinish = onFinishRecording,
                        onLock = { locked = true; haptic.performHapticFeedback(HapticFeedbackType.LongPress) },
                        onDrag = { dragHint = it }, onLockHint = { lockHint = it }
                    )
                }
                if (sendT > 0f) {
                    Box(
                        Modifier.graphicsLayer { alpha = sendT; scaleX = 0.5f + 0.5f * sendT; scaleY = 0.5f + 0.5f * sendT }
                            .size(48.dp).clip(CircleShape).background(if (canSend || recording) palette.accent else palette.muted.copy(alpha = 0.2f))
                            .clickable(enabled = showSend && (canSend || recording)) {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                if (recording) onFinishRecording() else onSend()
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.Send, if (recording) "Send voice message" else "Send message", tint = palette.onAccent, modifier = Modifier.size(24.dp).mirrorInRtl())
                    }
                }
                if (recording && !locked) LockCapsule(lockHint, palette, Modifier.align(Alignment.TopCenter).offset(y = (-116).dp))
            }
        }

        if (emojiOpen && !recording) {
            Spacer(Modifier.height(6.dp))
            EmojiPanel(recents = recents, palette = palette, height = keyboardDp.dp, onPick = { insert(it) }, onDismiss = { emojiOpen = false; keyboard?.show() })
        }
    }
}

/**
 * Mic button with the gesture state machine: press starts recording and the button grows and follows the finger;
 * releasing after a long press sends, releasing after a short tap locks it hands-free, sliding towards the start edge
 * past 80dp cancels, sliding up past 64dp locks (the lock capsule above fills as you go).
 */
@Composable
private fun MicButton(
    enabled: Boolean, recording: Boolean, rtl: Boolean, palette: ComposerPalette,
    onStart: () -> Unit, onCancel: () -> Unit, onFinish: () -> Unit, onLock: () -> Unit, onDrag: (Float) -> Unit, onLockHint: (Float) -> Unit
) {
    val density = LocalDensity.current
    val cancelPx = with(density) { 80.dp.toPx() }
    val lockPx = with(density) { 64.dp.toPx() }
    val currentEnabled by rememberUpdatedState(enabled)
    val start by rememberUpdatedState(onStart)
    val cancel by rememberUpdatedState(onCancel)
    val finish by rememberUpdatedState(onFinish)
    val lock by rememberUpdatedState(onLock)
    val drag by rememberUpdatedState(onDrag)
    val lockHint by rememberUpdatedState(onLockHint)
    var offset by remember { mutableStateOf(Offset.Zero) }
    val scale by animateFloatAsState(if (recording) 1.25f else 1f, tween(150), label = "micScale")
    // The touch target stays put and only the visual follows the finger; moving the target itself would shift the
    // coordinates the gesture is measured in.
    Box(
        Modifier.size(48.dp)
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
                        if (!resolved) {
                            offset = Offset((if (rtl) 1f else -1f) * towardsCancel.coerceIn(0f, cancelPx), dy.coerceIn(-lockPx, 0f))
                            drag((towardsCancel / cancelPx).coerceIn(0f, 1f))
                            lockHint((-dy / lockPx).coerceIn(0f, 1f))
                        }
                        if (!resolved && towardsCancel > cancelPx) { resolved = true; cancel() }
                        else if (!resolved && -dy > lockPx) { resolved = true; lock() }
                        ch.consume()
                        if (!ch.pressed) break
                    }
                    if (!resolved) {
                        // A quick tap leaves the recorder running hands-free; a held press is push-to-talk.
                        if (System.currentTimeMillis() - t0 < 350) lock() else finish()
                    }
                    offset = Offset.Zero
                    drag(0f)
                    lockHint(0f)
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Box(
            Modifier.size(48.dp)
                .graphicsLayer { translationX = offset.x; translationY = offset.y; scaleX = scale; scaleY = scale }
                .clip(CircleShape).background(if (recording) MaterialTheme.colorScheme.error else palette.accent.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Outlined.Mic, "Record voice message", tint = if (recording) MaterialTheme.colorScheme.onError else palette.accent, modifier = Modifier.size(24.dp))
        }
    }
}

/** The capsule above the mic while recording: it shrinks and its padlock closes as the mic is slid up to lock. */
@Composable
private fun LockCapsule(hint: Float, palette: ComposerPalette, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier.width(40.dp).height((96f - 28f * hint).dp).clip(shape).background(palette.card).border(1.dp, palette.border, shape),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        Icon(if (hint > 0.6f) Icons.Outlined.Lock else Icons.Outlined.LockOpen, null, tint = palette.accent, modifier = Modifier.size(20.dp))
        Icon(Icons.Outlined.KeyboardArrowUp, null, tint = palette.muted, modifier = Modifier.size(18.dp).alpha(1f - hint))
    }
}

/**
 * The recording state inside the composer pill. Held: a pulsing red dot, a tenths timer and the slide-to-cancel hint.
 * Locked: delete, a live waveform that scrolls with the mic level, and a stop button that opens the preview. On
 * cancel the whole row shrinks and fades ([discardT] 0..1) before the recording is dropped.
 */
@Composable
private fun RecordingRow(
    palette: ComposerPalette, locked: Boolean, rtl: Boolean, dragHint: Float, discardT: Float, liveLevels: List<Int>,
    onDelete: () -> Unit, onStop: (() -> Unit)?, modifier: Modifier = Modifier
) {
    val error = MaterialTheme.colorScheme.error
    val pulse by rememberInfiniteTransition(label = "rec").animateFloat(
        1f, 0.3f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "recDot"
    )
    val elapsedMs by produceState(0L) {
        val t0 = SystemClock.elapsedRealtime()
        while (true) { value = SystemClock.elapsedRealtime() - t0; delay(100) }
    }
    Row(
        modifier.heightIn(min = 48.dp).graphicsLayer { alpha = 1f - discardT; scaleX = 1f - 0.25f * discardT; scaleY = 1f - 0.25f * discardT },
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (locked) CoveIconButton(Icons.Outlined.Delete, "Cancel recording", onDelete, tint = error, size = 48.dp, iconSize = 24.dp)
        else Spacer(Modifier.width(Spacing.lg))
        Box(Modifier.size(12.dp).alpha(pulse).clip(CircleShape).background(error))
        Spacer(Modifier.width(8.dp))
        androidx.compose.material3.Text(
            "%d:%02d,%d".format(elapsedMs / 60000, elapsedMs / 1000 % 60, elapsedMs % 1000 / 100),
            color = palette.text, fontSize = 16.sp, fontWeight = FontWeight.Medium
        )
        Spacer(Modifier.width(10.dp))
        if (locked) {
            Canvas(Modifier.weight(1f).height(28.dp)) {
                val barW = 3.dp.toPx()
                val gap = 2.dp.toPx()
                val fit = (size.width / (barW + gap)).toInt().coerceAtLeast(1)
                val data = liveLevels.takeLast(fit)
                data.forEachIndexed { i, v ->
                    val h = maxOf(4.dp.toPx(), size.height * v / 100f)
                    val x = size.width - (data.size - i) * (barW + gap)
                    drawRoundRect(palette.accent, Offset(x, (size.height - h) / 2f), Size(barW, h), CornerRadius(barW / 2f))
                }
            }
            if (onStop != null) {
                Box(
                    Modifier.padding(horizontal = 6.dp).size(36.dp).clip(CircleShape).background(error.copy(alpha = 0.16f)).clickable(onClick = onStop),
                    contentAlignment = Alignment.Center
                ) { Box(Modifier.size(13.dp).clip(RoundedCornerShape(3.dp)).background(error)) }
            } else Spacer(Modifier.width(Spacing.md))
        } else {
            Row(Modifier.weight(1f).alpha(1f - dragHint * 0.6f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, null, tint = palette.muted, modifier = Modifier.size(18.dp))
                Text(if (rtl) "Slide right to cancel" else "Slide left to cancel", color = palette.muted, fontSize = 14.sp, maxLines = 1, modifier = Modifier.padding(end = Spacing.md))
            }
        }
    }
}

/**
 * Reply / edit strip inside the composer, Telegram style: an accent icon, a primary accent bar and two lines (who or
 * what, then the quoted text). Tapping it jumps to the original message; the close button cancels.
 */
@Composable
private fun ReplyBanner(ctx: InputContext, palette: ComposerPalette, onCancel: () -> Unit, onJump: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = ctx.messageId != null, onClick = onJump)
            .padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            if (ctx.isEdit) Icons.Outlined.Edit else Icons.AutoMirrored.Outlined.Reply, null,
            tint = palette.accent, modifier = Modifier.size(22.dp).mirrorInRtl()
        )
        Spacer(Modifier.width(10.dp))
        Box(Modifier.width(3.dp).height(34.dp).clip(RoundedCornerShape(2.dp)).background(palette.accent))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (ctx.isEdit) "Editing message" else "Replying to ${ctx.author}",
                color = palette.accent, fontSize = CoveType.label.fontSize, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis
            )
            Text(ctx.snippet, color = palette.text.copy(alpha = 0.8f), fontSize = CoveType.label.fontSize, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        CoveIconButton(Icons.Outlined.Close, "Cancel", onCancel, tint = palette.muted, size = 36.dp, iconSize = 18.dp)
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

/**
 * Emoji picker that takes the keyboard's place: a "recent" tab (when there are recents), the category tabs along the
 * bottom and a grid of 8 columns above them, at [height] so swapping with the keyboard does not shift the layout.
 */
@Composable
private fun EmojiPanel(recents: List<String>, palette: ComposerPalette, height: Dp, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val tabs = remember(recents) {
        (if (recents.isNotEmpty()) listOf(EmojiCategory("🕘", recents)) else emptyList()) + EmojiCategories
    }
    var selected by remember { mutableStateOf(0) }
    val tab = tabs[selected.coerceIn(0, tabs.lastIndex)]
    Column(Modifier.fillMaxWidth().height(height).clip(CoveShapes.lg).background(palette.popover).border(1.dp, palette.border, CoveShapes.lg)) {
        LazyVerticalGrid(columns = GridCells.Fixed(8), modifier = Modifier.fillMaxWidth().weight(1f).padding(8.dp)) {
            items(tab.emojis) { e ->
                Box(Modifier.size(40.dp).clickable { onPick(e) }, contentAlignment = Alignment.Center) { androidx.compose.material3.Text(e, fontSize = 24.sp) }
            }
        }
        Row(Modifier.fillMaxWidth().border(1.dp, palette.border).padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            tabs.forEachIndexed { i, cat ->
                Box(
                    Modifier.weight(1f).height(40.dp).clickable { selected = i }
                        .background(if (i == selected) palette.accent.copy(alpha = 0.15f) else Color.Transparent),
                    contentAlignment = Alignment.Center
                ) { androidx.compose.material3.Text(cat.icon, fontSize = CoveType.title.fontSize, modifier = Modifier.alpha(if (i == selected) 1f else 0.6f)) }
            }
            Box(Modifier.size(40.dp).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, "Close", tint = palette.muted, modifier = Modifier.size(16.dp))
            }
        }
    }
}
