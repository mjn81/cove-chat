package com.cove.chat.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlin.math.abs

/**
 * Waveform (or tick) bar with two draggable trim handles and a playhead, shared by the voice-note and video-message
 * previews. Dragging near a handle moves it (never closer than [minGap] to the other one); touching elsewhere seeks.
 * State lives in the caller: [onTrim] reports the new handle positions and [onSeek] a tap position, all as 0..1
 * fractions of the whole recording.
 */
@Composable
internal fun TrimBar(
    bars: ByteArray,
    start: Float,
    end: Float,
    position: Float,
    minGap: Float,
    palette: ComposerPalette,
    onTrim: (start: Float, end: Float) -> Unit,
    onSeek: (fraction: Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val handlePx = with(LocalDensity.current) { 22.dp.toPx() }
    val startNow by rememberUpdatedState(start)
    val endNow by rememberUpdatedState(end)
    val trim by rememberUpdatedState(onTrim)
    val seek by rememberUpdatedState(onSeek)
    Canvas(
        modifier.pointerInput(minGap) {
            awaitEachGesture {
                val down = awaitFirstDown()
                val w = size.width.toFloat()
                val x0 = down.position.x
                val dStart = abs(x0 - startNow * w)
                val dEnd = abs(x0 - endNow * w)
                // Which handle was grabbed (if any); otherwise the touch seeks.
                val grabbed = when {
                    dStart <= handlePx && dStart <= dEnd -> 0
                    dEnd <= handlePx -> 1
                    else -> 2
                }
                var moved = false
                while (true) {
                    val ev = awaitPointerEvent()
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    val f = (ch.position.x / w).coerceIn(0f, 1f)
                    if (abs(ch.position.x - x0) > 6f) moved = true
                    if (moved) when (grabbed) {
                        0 -> trim(AudioTrim.moveStart(f, endNow, minGap), endNow)
                        1 -> trim(startNow, AudioTrim.moveEnd(f, startNow, minGap))
                    }
                    ch.consume()
                    if (!ch.pressed) break
                }
                if (grabbed == 2) seek((x0 / w).coerceIn(0f, 1f))
            }
        }
    ) {
        val n = bars.size.coerceAtLeast(1)
        val slot = size.width / n
        val barW = (slot * 0.62f).coerceAtLeast(1.5f)
        for (i in 0 until n) {
            val frac = (i + 0.5f) / n
            val v = (bars.getOrElse(i) { 0 }.toInt()).coerceIn(8, 100) / 100f
            val h = size.height * 0.85f * v
            val color = when {
                frac !in start..end -> palette.muted.copy(alpha = 0.3f)
                frac <= position -> palette.accent
                else -> palette.text.copy(alpha = 0.7f)
            }
            drawRoundRect(color, Offset(i * slot + (slot - barW) / 2f, (size.height - h) / 2f), Size(barW, h), CornerRadius(barW / 2f))
        }
        val hw = 4.dp.toPx()
        for (x in listOf(start * size.width, end * size.width)) {
            drawRoundRect(palette.accent, Offset(x - hw / 2f, 0f), Size(hw, size.height), CornerRadius(hw / 2f))
            drawCircle(palette.accent, 6.dp.toPx(), Offset(x, size.height / 2f))
        }
    }
}
