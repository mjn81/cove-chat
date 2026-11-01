package com.cove.chat.ui.screens

import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveType
import androidx.compose.material3.MaterialTheme
import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.PlaybackParams
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.QueueMusic
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.RepeatOne
import androidx.compose.material.icons.outlined.VolumeDown
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.data.model.FileMeta
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** A voice note that can be played: where to fetch it and how to label it in the player bar. */
class VoiceTrack(val channelId: String, val meta: FileMeta, val label: String)

enum class RepeatMode { None, Once, All }

val PlaybackSpeeds = listOf(1f, 1.5f, 2f, 2.5f, 3f)

/**
 * Process-wide voice-note player, the Android counterpart of client-web `lib/voicePlayer.ts`: one track at a time,
 * shared by every voice bubble and by the top [VoicePlayerBar] (play/pause, seek, speed, volume, repeat, close).
 * State is Compose snapshot state so any composable reading it recomposes while the audio plays.
 */
object VoicePlayerController {
    var track by mutableStateOf<VoiceTrack?>(null)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var positionMs by mutableLongStateOf(0L)
        private set
    var durationMs by mutableLongStateOf(0L)
        private set
    var speed by mutableFloatStateOf(1f)
        private set
    var volume by mutableFloatStateOf(1f)
        private set
    var repeat by mutableStateOf(RepeatMode.None)
        private set

    /** Audio of the chat being listened to, oldest first: the playlist, and what plays next when a track ends. */
    var queue by mutableStateOf<List<VoiceTrack>>(emptyList())
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var appContext: Context? = null
    private var player: MediaPlayer? = null
    private var ticker: Job? = null
    private var loadJob: Job? = null

    /**
     * Sets the playlist. A queue for another chat is ignored while something from a different chat is playing,
     * so browsing never rewrites the list under the track that is playing.
     */
    fun setQueue(channelId: String, tracks: List<VoiceTrack>) {
        val current = track
        if (current != null && current.channelId != channelId) return
        queue = tracks
    }

    /** Plays the next queued track; does nothing at the end. */
    fun next(context: Context) = step(context, 1)

    /** Plays the previous queued track; does nothing at the start. */
    fun previous(context: Context) = step(context, -1)

    private fun step(context: Context, direction: Int) {
        val current = track ?: return
        val id = neighbourId(queue.map { it.meta.fileId }, current.meta.fileId, direction) ?: return
        queue.firstOrNull { it.meta.fileId == id }?.let { play(context, it) }
    }

    /** Plays [t], or toggles pause when it is already the current track. */
    fun play(context: Context, requested: VoiceTrack) {
        // A bubble only knows the file name; the queue carries the proper title (who sent it).
        val t = queue.firstOrNull { it.meta.fileId == requested.meta.fileId }?.let { VoiceTrack(requested.channelId, requested.meta, it.label) } ?: requested
        if (track?.meta?.fileId == t.meta.fileId && player != null) { toggle(); return }
        stop()
        track = t
        isLoading = true
        val app = context.applicationContext
        appContext = app
        loadJob = scope.launch {
            val data = loadAttachment(t.channelId, t.meta)
            if (data == null) { fail(app, "Couldn't load the voice message."); return@launch }
            val ext = if (t.meta.mime.contains("webm")) "webm" else if (t.meta.mime.contains("ogg")) "ogg" else "m4a"
            val file = File(app.cacheDir, "attachments").apply { mkdirs() }.let { File(it, "voice_${t.meta.fileId}.$ext") }
            withContext(Dispatchers.IO) { file.writeBytes(data) }
            runCatching {
                MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).setUsage(AudioAttributes.USAGE_MEDIA).build())
                    setDataSource(file.absolutePath)
                    setVolume(volume, volume)
                    setOnCompletionListener { onCompleted() }
                    prepare()
                }
            }.onSuccess { mp ->
                player = mp
                // Browser MediaRecorder webm files carry no duration header, so MediaPlayer reports 0 / -1: use the sent length.
                durationMs = mp.duration.toLong().takeIf { it > 0 } ?: ((t.meta.duration ?: 0) * 1000L)
                positionMs = 0
                isLoading = false
                startPlayback()
            }.onFailure { fail(app, "This audio format can't be played.") }
        }
    }

    private fun fail(context: Context, message: String) {
        I18nToast.make(context, message, android.widget.Toast.LENGTH_SHORT).show()
        stop()
    }

    private fun startPlayback() {
        val mp = player ?: return
        mp.start()
        applySpeed()
        isPlaying = true
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive && isPlaying) {
                positionMs = player?.currentPosition?.toLong() ?: 0L
                delay(100)
            }
        }
    }

    fun toggle() {
        val mp = player ?: return
        if (mp.isPlaying) { mp.pause(); isPlaying = false } else startPlayback()
    }

    /** [fraction] of the track, 0..1. */
    fun seek(fraction: Float) {
        val mp = player ?: return
        val target = (fraction.coerceIn(0f, 1f) * durationMs).toLong()
        mp.seekTo(target.toInt())
        positionMs = target
    }

    fun cycleSpeed() = changeSpeed(PlaybackSpeeds[(PlaybackSpeeds.indexOf(speed).coerceAtLeast(0) + 1) % PlaybackSpeeds.size])

    fun changeSpeed(value: Float) {
        speed = value.coerceIn(0.5f, 4f)
        if (isPlaying) applySpeed()
    }

    /** PlaybackParams on API 26+ resume playback when set on a paused player, so only apply while playing. */
    private fun applySpeed() {
        val mp = player ?: return
        runCatching { mp.playbackParams = PlaybackParams().setSpeed(speed).setPitch(1f) }
    }

    fun changeVolume(value: Float) {
        volume = value.coerceIn(0f, 1f)
        player?.setVolume(volume, volume)
    }

    fun cycleRepeat() {
        repeat = when (repeat) { RepeatMode.None -> RepeatMode.Once; RepeatMode.Once -> RepeatMode.All; RepeatMode.All -> RepeatMode.None }
    }

    private fun onCompleted() {
        when (repeat) {
            RepeatMode.All -> { player?.seekTo(0); startPlayback() }
            RepeatMode.Once -> { repeat = RepeatMode.None; player?.seekTo(0); startPlayback() }
            RepeatMode.None -> {
                isPlaying = false; positionMs = 0; player?.seekTo(0)
                // Like Telegram, the next audio in the chat starts by itself.
                appContext?.let { next(it) }
            }
        }
    }

    /** Stops playback and hides the player bar. */
    fun stop() {
        loadJob?.cancel(); ticker?.cancel()
        runCatching { player?.release() }
        player = null
        track = null
        isPlaying = false; isLoading = false; positionMs = 0; durationMs = 0
    }
}

/**
 * Voice note card, same layout as web `VoiceBubble`: `bg-secondary/80` rounded-2xl box with a 40dp primary play
 * button, 32dp waveform bars (played part in primary) and a tiny time + download row. Playback goes through
 * [VoicePlayerController] so the bar at the top of the chat controls it too.
 */
@Composable
fun VoiceBubble(channelId: String, meta: FileMeta, keyVersion: Int, author: String = "") {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ctl = VoicePlayerController
    val active = ctl.track?.meta?.fileId == meta.fileId
    val thisPlaying = active && ctl.isPlaying
    val thisLoading = active && ctl.isLoading
    val progress = if (active && ctl.durationMs > 0) ctl.positionMs.toFloat() / ctl.durationMs else 0f
    val peaks = remember(meta.fileId, keyVersion) { decryptPreview(channelId, meta)?.map { (it.toInt() and 0xFF).coerceIn(0, 100) } }
    val shownSeconds = if (active && ctl.durationMs > 0) (if (ctl.positionMs > 0) ctl.positionMs / 1000 else ctl.durationMs / 1000).toInt() else meta.duration ?: 0

    Row(
        Modifier
            .padding(top = 8.dp)
            .widthIn(max = 320.dp)
            .fillMaxWidth()
            .clip(CoveShapes.lg)
            .background(c.card)
            .border(1.dp, c.border, CoveShapes.lg)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable(enabled = !thisLoading) {
                ctl.play(context, VoiceTrack(channelId, meta, author.ifBlank { "Voice message" }))
            },
            contentAlignment = Alignment.Center
        ) {
            if (thisLoading) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            else Icon(if (thisPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (thisPlaying) "Pause" else "Play", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth().height(32.dp).padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(1.5.dp), verticalAlignment = Alignment.Bottom) {
                if (peaks != null && peaks.isNotEmpty()) {
                    peaks.forEachIndexed { i, peak ->
                        val played = active && progress > i.toFloat() / peaks.size
                        Box(
                            Modifier.weight(1f).fillMaxHeight(maxOf(15, peak) / 100f).clip(CircleShape)
                                .background(if (played) MaterialTheme.colorScheme.primary else c.textMuted.copy(alpha = 0.3f))
                        )
                    }
                } else {
                    Box(Modifier.fillMaxWidth().height(4.dp).align(Alignment.CenterVertically).clip(CircleShape).background(c.textMuted.copy(alpha = 0.2f)))
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(mmss(shownSeconds), color = c.textMuted, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                Icon(
                    Icons.Outlined.FileDownload, "Download Voice Note", tint = c.textMuted,
                    modifier = Modifier.size(14.dp).clickable { scope.launch { openAttachment(context, channelId, meta) } }
                )
            }
        }
    }
}

/**
 * Thin seek bar whose track and thumb share one vertical centre line. The Material `Slider` reserves a 48dp touch
 * target and offset its track from the row's text baseline, which left the bar visibly off-centre in the player strip.
 *
 * @param fraction playback position, 0..1.
 * @param onDrag called continuously while the finger moves, with the position under it.
 * @param onCommit called on tap or when a drag ends, with the position to seek to.
 */
@Composable
private fun SeekBar(
    fraction: Float,
    onDrag: (Float) -> Unit,
    onCommit: (Float) -> Unit,
    activeColor: Color,
    inactiveColor: Color,
    modifier: Modifier = Modifier,
    compact: Boolean = false
) {
    val shown = fraction.coerceIn(0f, 1f)
    var last by remember { mutableFloatStateOf(0f) }
    var held by remember { mutableStateOf(false) }
    val trackHeight = if (compact) 3.dp else 4.dp
    Box(
        modifier
            .height(if (compact) 16.dp else 28.dp)
            .pointerInput(Unit) {
                detectTapGestures { off -> onCommit((off.x / size.width).coerceIn(0f, 1f)) }
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { off -> held = true; last = (off.x / size.width).coerceIn(0f, 1f); onDrag(last) },
                    onDragEnd = { held = false; onCommit(last) },
                    onDragCancel = { held = false; onCommit(last) },
                    onHorizontalDrag = { change, _ -> last = (change.position.x / size.width).coerceIn(0f, 1f); onDrag(last) }
                )
            },
        contentAlignment = if (compact) Alignment.BottomStart else Alignment.CenterStart
    ) {
        val corner = if (compact) androidx.compose.ui.graphics.RectangleShape else CircleShape
        Box(Modifier.fillMaxWidth().height(trackHeight).clip(corner).background(inactiveColor))
        Box(Modifier.fillMaxWidth(shown).height(trackHeight).clip(corner).background(activeColor))
        // The compact edge bar only shows its thumb while it is being dragged.
        if (!compact || held) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (shown > 0f) Spacer(Modifier.weight(shown))
            Box(Modifier.size(10.dp).clip(CircleShape).background(activeColor))
            if (shown < 1f) Spacer(Modifier.weight(1f - shown))
        }
    }
}

/**
 * Persistent player under the chat header while a voice note is loaded (web `VoicePlayer` bar), laid out like
 * Telegram's audio bar: a round play button, the title with `0:02 / 0:04` under it, then speed (1x-3x), volume, repeat
 * (off / once / all) and close. The seek bar runs along the whole bottom edge, so it keeps its length however many
 * controls sit above it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoicePlayerBar(modifier: Modifier = Modifier) {
    val ctl = VoicePlayerController
    val t = ctl.track ?: return
    val c = CoveTheme.extendedColors
    var dragging by remember { mutableStateOf(false) }
    var dragValue by remember { mutableFloatStateOf(0f) }
    var volumeOpen by remember { mutableStateOf(false) }
    var playlistOpen by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val fraction = if (ctl.durationMs > 0) ctl.positionMs.toFloat() / ctl.durationMs else 0f

    Box(modifier.fillMaxWidth().background(c.chatCanvas)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable(enabled = !ctl.isLoading) { ctl.toggle() },
                contentAlignment = Alignment.Center
            ) {
                if (ctl.isLoading) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                else Icon(if (ctl.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (ctl.isPlaying) "Pause" else "Play", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(t.label, color = c.textPrimary, fontSize = CoveType.label.fontSize, fontWeight = FontWeight.Bold, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(
                    "${mmss((ctl.positionMs / 1000).toInt())} / ${mmss((ctl.durationMs / 1000).toInt())}",
                    color = c.textMuted, fontSize = CoveType.caption.fontSize, fontFamily = FontFamily.Monospace
                )
            }
            Box(Modifier.widthIn(min = 40.dp).height(32.dp).clip(CoveShapes.md).clickable { ctl.cycleSpeed() }, contentAlignment = Alignment.Center) {
                Text("%.1fx".format(ctl.speed), color = if (ctl.speed != 1f) MaterialTheme.colorScheme.primary else c.textMuted, fontSize = CoveType.caption.fontSize, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
            }
            Box {
                Box(Modifier.size(32.dp).clip(CircleShape).clickable { volumeOpen = true }, contentAlignment = Alignment.Center) {
                    Icon(
                        when { ctl.volume == 0f -> Icons.Outlined.VolumeOff; ctl.volume < 0.5f -> Icons.Outlined.VolumeDown; else -> Icons.Outlined.VolumeUp },
                        "Volume", tint = if (ctl.volume == 0f) c.textMuted else MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)
                    )
                }
                DropdownMenu(expanded = volumeOpen, onDismissRequest = { volumeOpen = false }, containerColor = c.popover, shape = CoveShapes.md) {
                    Row(Modifier.padding(horizontal = 12.dp).widthIn(min = 180.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.VolumeOff, "Mute", tint = c.textMuted, modifier = Modifier.size(18.dp).clickable { ctl.changeVolume(if (ctl.volume > 0f) 0f else 1f) })
                        Slider(value = ctl.volume, onValueChange = { ctl.changeVolume(it) }, modifier = Modifier.weight(1f).padding(start = 8.dp))
                    }
                }
            }
            if (ctl.queue.size > 1) Box(Modifier.size(32.dp).clip(CircleShape).clickable { playlistOpen = true }, contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.QueueMusic, "Playlist", tint = if (playlistOpen) MaterialTheme.colorScheme.primary else c.textMuted, modifier = Modifier.size(18.dp))
            }
            Box(Modifier.size(32.dp).clip(CircleShape).clickable { ctl.cycleRepeat() }, contentAlignment = Alignment.Center) {
                Icon(
                    if (ctl.repeat == RepeatMode.Once) Icons.Outlined.RepeatOne else Icons.Outlined.Repeat,
                    "Repeat", tint = if (ctl.repeat == RepeatMode.None) c.textMuted else MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)
                )
            }
            Box(Modifier.size(32.dp).clip(CircleShape).clickable { ctl.stop() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Close, "Close player", tint = c.textMuted, modifier = Modifier.size(18.dp))
            }
        }
        SeekBar(
            fraction = if (dragging) dragValue else fraction,
            onDrag = { dragging = true; dragValue = it },
            onCommit = { ctl.seek(it); dragging = false },
            activeColor = MaterialTheme.colorScheme.primary,
            inactiveColor = c.accent,
            modifier = Modifier.align(Alignment.BottomCenter),
            compact = true
        )
    }

    if (playlistOpen) PlaylistSheet(onDismiss = { playlistOpen = false }, onPick = { ctl.play(context, it) })
}

/** Bottom sheet listing every voice note and audio file in the chat, with the current one highlighted. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlaylistSheet(onDismiss: () -> Unit, onPick: (VoiceTrack) -> Unit) {
    val ctl = VoicePlayerController
    val c = CoveTheme.extendedColors
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.popover, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Text("Playlist", color = c.textPrimary, fontSize = CoveType.body.fontSize, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
            items(ctl.queue, key = { it.meta.fileId }) { item ->
                val current = ctl.track?.meta?.fileId == item.meta.fileId
                Row(
                    Modifier.fillMaxWidth().clickable { onPick(item) }.padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        if (current && ctl.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, null,
                        tint = if (current) MaterialTheme.colorScheme.primary else c.textMuted, modifier = Modifier.size(22.dp)
                    )
                    Spacer(Modifier.width(14.dp))
                    Text(
                        item.label, color = if (current) MaterialTheme.colorScheme.primary else c.textPrimary, fontSize = CoveType.label.fontSize,
                        fontWeight = if (current) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    item.meta.duration?.let { Text(mmss(it), color = c.textMuted, fontSize = CoveType.caption.fontSize, fontFamily = FontFamily.Monospace) }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
