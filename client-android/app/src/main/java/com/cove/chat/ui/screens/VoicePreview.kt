package com.cove.chat.ui.screens

import android.media.MediaPlayer
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.mirrorInRtl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs

/**
 * In-place review of a finished voice recording, shown in the composer instead of sending straight away: play it, drag
 * the two handles on the waveform to cut off the start or end, tap the waveform to seek, then send or discard. A cut is
 * made without re-encoding ([AudioTrim.trimAac]); if it fails the untrimmed recording is sent.
 */
@Composable
internal fun VoicePreview(
    result: VoiceRecorder.Result,
    palette: ComposerPalette,
    onDiscard: () -> Unit,
    onSend: (VoiceRecorder.Result) -> Unit
) {
    val scope = rememberCoroutineScope()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val player = remember(result.file) {
        runCatching { MediaPlayer().apply { setDataSource(result.file.absolutePath); prepare() } }.getOrNull()
    }
    val totalMs = remember(player) { (player?.duration ?: (result.seconds * 1000)).toLong().coerceAtLeast(1000L) }
    DisposableEffect(player) { onDispose { runCatching { player?.release() } } }

    var start by remember { mutableStateOf(0f) }
    var end by remember { mutableStateOf(1f) }
    var position by remember { mutableStateOf(0f) } // 0..1 of the whole recording
    var playing by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    val minGap = AudioTrim.minGapFraction(totalMs)
    val startNow by rememberUpdatedState(start)
    val endNow by rememberUpdatedState(end)

    fun seek(f: Float) { position = f; player?.seekTo((f * totalMs).toInt()) }

    LaunchedEffect(playing) {
        val p = player ?: return@LaunchedEffect
        if (playing) {
            if (position < startNow || position >= endNow) seek(startNow)
            p.setOnCompletionListener { playing = false; seek(startNow) }
            p.start()
            while (playing) {
                position = p.currentPosition.toFloat() / totalMs
                // Stop at the end handle, not at the end of the file.
                if (position >= endNow) { p.pause(); playing = false; seek(startNow) }
                delay(40)
            }
        } else if (p.isPlaying) p.pause()
    }

    fun send() {
        if (sending) return
        sending = true
        playing = false
        scope.launch {
            val out = if (AudioTrim.isFullRange(start, end)) result else withContext(Dispatchers.IO) {
                val dst = File(result.file.parentFile, "voice_trim_${System.currentTimeMillis()}.m4a")
                val ok = AudioTrim.trimAac(result.file, dst, (start * totalMs * 1000).toLong(), (end * totalMs * 1000).toLong())
                if (ok) {
                    result.file.delete()
                    VoiceRecorder.Result(dst, AudioTrim.trimmedSeconds(totalMs, start, end), AudioTrim.slicePeaks(result.peaks, start, end))
                } else result // untrimmed fallback so the message still goes out
            }
            onSend(out)
        }
    }

    val handlePx = with(density) { 22.dp.toPx() }
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        CoveIconButton(Icons.Outlined.Delete, "Discard recording", onDiscard, tint = MaterialTheme.colorScheme.error, size = 48.dp, iconSize = 24.dp)
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(palette.accent.copy(alpha = 0.16f)).clickable(enabled = player != null) { playing = !playing },
            contentAlignment = Alignment.Center
        ) { Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause" else "Play", tint = palette.accent, modifier = Modifier.size(26.dp)) }
        Spacer(Modifier.width(10.dp))

        Canvas(
            Modifier.weight(1f).height(44.dp).pointerInput(minGap) {
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
                        when (grabbed) {
                            0 -> if (moved) { start = AudioTrim.moveStart(f, endNow, minGap); if (position < start) seek(start) }
                            1 -> if (moved) { end = AudioTrim.moveEnd(f, startNow, minGap); if (position > end) seek(end) }
                        }
                        ch.consume()
                        if (!ch.pressed) break
                    }
                    if (grabbed == 2) seek(((x0 / w)).coerceIn(startNow, endNow))
                }
            }
        ) {
            val n = result.peaks.size.coerceAtLeast(1)
            val slot = size.width / n
            val barW = (slot * 0.62f).coerceAtLeast(1.5f)
            for (i in 0 until n) {
                val frac = (i + 0.5f) / n
                val v = (result.peaks.getOrElse(i) { 0 }.toInt()).coerceIn(8, 100) / 100f
                val h = size.height * 0.85f * v
                val inside = frac in start..end
                val color = when {
                    !inside -> palette.muted.copy(alpha = 0.3f)
                    frac <= position -> palette.accent
                    else -> palette.text.copy(alpha = 0.7f)
                }
                drawRoundRect(color, Offset(i * slot + (slot - barW) / 2f, (size.height - h) / 2f), Size(barW, h), CornerRadius(barW / 2f))
            }
            // Trim handles.
            val hw = 4.dp.toPx()
            for (x in listOf(start * size.width, end * size.width)) {
                drawRoundRect(palette.accent, Offset(x - hw / 2f, 0f), Size(hw, size.height), CornerRadius(hw / 2f))
                drawCircle(palette.accent, 6.dp.toPx(), Offset(x, size.height / 2f))
            }
        }

        Text(
            mmss(AudioTrim.trimmedSeconds(totalMs, start, end)),
            color = palette.muted, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp, end = 6.dp)
        )
        Box(
            Modifier.padding(end = 4.dp).size(44.dp).clip(CircleShape).background(palette.accent).clickable(enabled = !sending, onClick = ::send),
            contentAlignment = Alignment.Center
        ) {
            if (sending) CircularProgressIndicator(color = palette.onAccent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            else Icon(Icons.AutoMirrored.Outlined.Send, "Send voice message", tint = palette.onAccent, modifier = Modifier.size(22.dp).mirrorInRtl())
        }
    }
}
