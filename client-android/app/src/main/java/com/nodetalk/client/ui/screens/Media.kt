package com.nodetalk.client.ui.screens

import android.content.Context
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.nodetalk.client.data.model.FileMeta
import com.nodetalk.client.ui.components.I18nToast
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Records a voice message as AAC in an MP4 container (`audio/mp4`): plays in every browser and on Android,
 * unlike the web client's webm/opus which Safari cannot decode. While recording it samples the microphone
 * level so the sent message carries a waveform like the web client's voice notes.
 */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val levels = ArrayList<Int>()
    private val sampler = object : Runnable {
        override fun run() {
            recorder?.let { levels.add(runCatching { it.maxAmplitude }.getOrDefault(0)) }
            if (recorder != null) handler.postDelayed(this, 80)
        }
    }

    fun start(): Boolean = runCatching {
        val out = File(context.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioEncodingBitRate(64_000)
        r.setAudioSamplingRate(44_100)
        r.setOutputFile(out.absolutePath)
        r.prepare()
        r.start()
        recorder = r
        file = out
        levels.clear()
        startedAt = SystemClock.elapsedRealtime()
        handler.post(sampler)
        true
    }.getOrDefault(false)

    /** A finished recording: the file, its length in seconds and 60 peak values (0-100) for the waveform. */
    class Result(val file: File, val seconds: Int, val peaks: ByteArray)

    /** Stops and returns the recording, or null if it was too short/invalid. */
    fun stop(): Result? {
        val r = recorder ?: return null
        recorder = null
        handler.removeCallbacks(sampler)
        val seconds = ((SystemClock.elapsedRealtime() - startedAt) / 1000).toInt()
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val f = file
        if (!ok || f == null || seconds < 1) { f?.delete(); return null }
        return Result(f, seconds, peaks(60))
    }

    fun cancel() {
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        handler.removeCallbacks(sampler)
        file?.delete()
    }

    /** Resamples the level history to [count] buckets (max per bucket), scaled like web `generateWaveform`. */
    private fun peaks(count: Int): ByteArray {
        if (levels.isEmpty()) return ByteArray(count)
        val out = ByteArray(count)
        for (i in 0 until count) {
            val from = i * levels.size / count
            val to = maxOf(from + 1, (i + 1) * levels.size / count).coerceAtMost(levels.size)
            val peak = levels.subList(from, to).maxOrNull() ?: 0
            out[i] = minOf(100, (peak / 32767f * 100f * 1.6f).toInt()).toByte()
        }
        return out
    }
}

private fun mmss(seconds: Int) = "%d:%02d".format(seconds / 60, seconds % 60)

/**
 * Voice note card, same layout as web `VoiceBubble`: `bg-secondary/80` rounded-2xl box with a 40dp primary play
 * button, 32dp waveform bars (played part in primary) and a tiny time + download row.
 */
@Composable
fun VoiceBubble(channelId: String, meta: FileMeta, keyVersion: Int) {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var positionSec by remember { mutableStateOf(0) }
    val peaks = remember(meta.fileId, keyVersion) { decryptPreview(channelId, meta)?.map { (it.toInt() and 0xFF).coerceIn(0, 100) } }

    DisposableEffect(meta.fileId) { onDispose { player?.release(); player = null } }
    LaunchedEffect(playing) {
        while (playing) {
            player?.let { if (it.duration > 0) { progress = it.currentPosition.toFloat() / it.duration; positionSec = it.currentPosition / 1000 } }
            delay(100)
        }
    }

    fun toggle() {
        val p = player
        if (p != null) {
            if (p.isPlaying) { p.pause(); playing = false } else { p.start(); playing = true }
            return
        }
        loading = true
        scope.launch {
            val data = loadAttachment(channelId, meta)
            if (data == null) {
                I18nToast.make(context, "Couldn't load the voice message.", android.widget.Toast.LENGTH_SHORT).show()
                loading = false
                return@launch
            }
            val ext = if (meta.mime.contains("webm")) "webm" else if (meta.mime.contains("ogg")) "ogg" else "m4a"
            val f = File(context.cacheDir, "attachments").apply { mkdirs() }.let { File(it, "voice_${meta.fileId}.$ext") }
            withContext(Dispatchers.IO) { f.writeBytes(data) }
            runCatching {
                MediaPlayer().apply {
                    setDataSource(f.absolutePath)
                    setOnCompletionListener { playing = false; progress = 0f; positionSec = 0; seekTo(0) }
                    prepare()
                    start()
                }
            }.onSuccess { player = it; playing = true }
                .onFailure { I18nToast.make(context, "This audio format can't be played.", android.widget.Toast.LENGTH_SHORT).show() }
            loading = false
        }
    }

    Row(
        Modifier
            .padding(top = 8.dp)
            .widthIn(max = 320.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.card.copy(alpha = 0.8f))
            .border(1.dp, c.border, RoundedCornerShape(16.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(NTPrimary).clickable(enabled = !loading) { toggle() }, contentAlignment = Alignment.Center) {
            if (loading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            else Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause" else "Play", tint = Color.White, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth().height(32.dp).padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(1.5.dp), verticalAlignment = Alignment.Bottom) {
                if (peaks != null && peaks.isNotEmpty()) {
                    peaks.forEachIndexed { i, peak ->
                        val played = (playing || progress > 0f) && progress > i.toFloat() / peaks.size
                        Box(
                            Modifier.weight(1f).fillMaxHeight(maxOf(15, peak) / 100f).clip(CircleShape)
                                .background(if (played) NTPrimary else c.textMuted.copy(alpha = 0.3f))
                        )
                    }
                } else {
                    Box(Modifier.fillMaxWidth().height(4.dp).align(Alignment.CenterVertically).clip(CircleShape).background(c.textMuted.copy(alpha = 0.2f)))
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    mmss(if (playing || positionSec > 0) positionSec else meta.duration ?: 0),
                    color = c.textMuted, fontSize = 10.sp, fontWeight = FontWeight.Medium
                )
                Icon(
                    Icons.Outlined.FileDownload, "Download Voice Note", tint = c.textMuted,
                    modifier = Modifier.size(14.dp).clickable { scope.launch { openAttachment(context, channelId, meta) } }
                )
            }
        }
    }
}

/**
 * Video message tile like web `VideoMessageBubble`: a 256dp square with 32dp corners on black, a blurred
 * thumbnail underneath, a primary rounded play button in the middle and a duration pill at the bottom.
 */
@Composable
fun VideoBubble(channelId: String, meta: FileMeta, keyVersion: Int = 0) {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val thumb = remember(meta.fileId, keyVersion) {
        decryptPreview(channelId, meta)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
    }
    val shape = RoundedCornerShape(32.dp)

    Box(
        Modifier
            .padding(vertical = 4.dp)
            .size(256.dp)
            .clip(shape)
            .background(Color.Black)
            .border(1.dp, c.border.copy(alpha = 0.5f), shape)
            .clickable(enabled = !loading) {
                if (path != null) return@clickable
                loading = true
                scope.launch {
                    val data = loadAttachment(channelId, meta)
                    if (data == null) {
                        I18nToast.make(context, "Couldn't load the video message.", android.widget.Toast.LENGTH_SHORT).show()
                    } else {
                        val ext = if (meta.mime.contains("webm")) "webm" else "mp4"
                        val f = File(context.cacheDir, "attachments").apply { mkdirs() }.let { File(it, "video_${meta.fileId}.$ext") }
                        withContext(Dispatchers.IO) { f.writeBytes(data) }
                        path = f.absolutePath
                    }
                    loading = false
                }
            },
        contentAlignment = Alignment.Center
    ) {
        if (thumb != null) {
            Image(thumb.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().blur(12.dp))
        } else {
            Box(Modifier.fillMaxSize().background(c.card.copy(alpha = 0.8f)))
        }
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(NTPrimary.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
            if (loading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            else Icon(Icons.Rounded.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(30.dp))
        }
        Row(
            Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                mmss(meta.duration ?: 0), color = Color.White.copy(alpha = 0.9f), fontSize = 11.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).border(1.dp, Color.White.copy(alpha = 0.1f), CircleShape).padding(horizontal = 10.dp, vertical = 2.dp)
            )
            Box(
                Modifier.size(28.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).border(1.dp, Color.White.copy(alpha = 0.1f), CircleShape)
                    .clickable { scope.launch { openAttachment(context, channelId, meta) } },
                contentAlignment = Alignment.Center
            ) { Icon(Icons.Outlined.FileDownload, "Download", tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(14.dp)) }
        }
    }

    path?.let { file ->
        Dialog(onDismissRequest = { path = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
                AndroidView(
                    factory = { ctx ->
                        VideoView(ctx).apply {
                            setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
                            setVideoPath(file)
                            setOnPreparedListener { start() }
                            setOnErrorListener { _, _, _ ->
                                I18nToast.make(ctx, "This video can't be played.", android.widget.Toast.LENGTH_SHORT).show()
                                path = null
                                true
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(320.dp).clip(RoundedCornerShape(16.dp))
                )
                Icon(
                    Icons.Outlined.Close, "Close", tint = Color.White,
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp).size(28.dp).clip(CircleShape).clickable { path = null }
                )
            }
        }
    }
}

/** Encrypts and sends a finished voice recording together with its encrypted waveform. */
suspend fun sendVoiceFile(result: VoiceRecorder.Result, channelId: String) = withContext(Dispatchers.IO) {
    try {
        sendPrepared(channelId, result.file.readBytes(), "audio/mp4", "voice-message.m4a", "voice", durationSec = result.seconds, preview = result.peaks)
    } finally {
        result.file.delete()
    }
}

/** Encrypts and sends a video recorded with the system camera (max 60 s, enforced by the capture intent). */
suspend fun sendVideoFile(file: File, channelId: String) = withContext(Dispatchers.IO) {
    try {
        var seconds = 0
        var preview: ByteArray? = null
        runCatching {
            val r = MediaMetadataRetriever()
            r.setDataSource(file.absolutePath)
            seconds = ((r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000).toInt()
            preview = r.getFrameAtTime(0)?.let { thumbnailWebp(it) }
            r.release()
        }
        sendPrepared(channelId, file.readBytes(), "video/mp4", "video-message.mp4", "video", durationSec = seconds, preview = preview)
    } finally {
        file.delete()
    }
}
