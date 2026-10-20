package com.nodetalk.client.ui.screens

import com.nodetalk.client.ui.components.I18nToast
import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import com.nodetalk.client.ui.components.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.nodetalk.client.data.model.FileMeta
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Records a voice message as AAC in an MP4 container (`audio/mp4`): plays in every browser and on Android,
 * unlike the web client's webm/opus which Safari cannot decode.
 */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L

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
        startedAt = SystemClock.elapsedRealtime()
        true
    }.getOrDefault(false)

    /** Stops and returns the recording with its length in seconds, or null if it was too short/invalid. */
    fun stop(): Pair<File, Int>? {
        val r = recorder ?: return null
        recorder = null
        val seconds = ((SystemClock.elapsedRealtime() - startedAt) / 1000).toInt()
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val f = file
        return if (ok && f != null && seconds >= 1) f to seconds else { f?.delete(); null }
    }

    fun cancel() {
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        file?.delete()
    }
}

private fun mmss(seconds: Int) = "%d:%02d".format(seconds / 60, seconds % 60)

/** Voice note player: downloads + decrypts on first play, then streams from a private cache file. */
@Composable
fun VoiceBubble(channelId: String, meta: FileMeta, keyVersion: Int) {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }

    DisposableEffect(meta.fileId) { onDispose { player?.release(); player = null } }
    LaunchedEffect(playing) {
        while (playing) {
            player?.let { if (it.duration > 0) progress = it.currentPosition.toFloat() / it.duration }
            delay(200)
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
                I18nToast.make(context, "Couldn't load the voice message.", Toast.LENGTH_SHORT).show()
                loading = false
                return@launch
            }
            val ext = if (meta.mime.contains("webm")) "webm" else if (meta.mime.contains("ogg")) "ogg" else "m4a"
            val f = File(context.cacheDir, "attachments").apply { mkdirs() }.let { File(it, "voice_${meta.fileId}.$ext") }
            withContext(Dispatchers.IO) { f.writeBytes(data) }
            runCatching {
                MediaPlayer().apply {
                    setDataSource(f.absolutePath)
                    setOnCompletionListener { playing = false; progress = 0f; seekTo(0) }
                    prepare()
                    start()
                }
            }.onSuccess { player = it; playing = true }
                .onFailure { I18nToast.make(context, "This audio format can't be played.", Toast.LENGTH_SHORT).show() }
            loading = false
        }
    }

    Row(
        Modifier
            .padding(top = 4.dp)
            .fillMaxWidth(0.85f)
            .clip(RoundedCornerShape(6.dp))
            .border(1.dp, c.border, RoundedCornerShape(6.dp))
            .background(c.card)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(4.dp)).background(NTPrimary).clickable(enabled = !loading) { toggle() }, contentAlignment = Alignment.Center) {
            if (loading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            else Icon(if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (playing) "Pause" else "Play", tint = Color.White)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            LinearProgressIndicator(progress = { progress }, color = NTPrimary, trackColor = c.accent, modifier = Modifier.fillMaxWidth().height(4.dp))
            Spacer(Modifier.height(6.dp))
            Text("Voice message · ${mmss(meta.duration ?: 0)}", color = c.textMuted, fontSize = 12.sp)
        }
    }
}

/** Video message card; tapping downloads/decrypts it and plays it full-screen with system controls. */
@Composable
fun VideoBubble(channelId: String, meta: FileMeta) {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var path by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    Row(
        Modifier
            .padding(top = 4.dp)
            .fillMaxWidth(0.85f)
            .clip(RoundedCornerShape(6.dp))
            .border(1.dp, c.border, RoundedCornerShape(6.dp))
            .background(c.card)
            .clickable(enabled = !loading) {
                if (path != null) return@clickable
                loading = true
                scope.launch {
                    val data = loadAttachment(channelId, meta)
                    if (data == null) {
                        I18nToast.make(context, "Couldn't load the video message.", Toast.LENGTH_SHORT).show()
                    } else {
                        val ext = if (meta.mime.contains("webm")) "webm" else "mp4"
                        val f = File(context.cacheDir, "attachments").apply { mkdirs() }.let { File(it, "video_${meta.fileId}.$ext") }
                        withContext(Dispatchers.IO) { f.writeBytes(data) }
                        path = f.absolutePath
                    }
                    loading = false
                }
            }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(4.dp)).background(NTPrimary), contentAlignment = Alignment.Center) {
            if (loading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            else Icon(Icons.Outlined.PlayArrow, "Play video", tint = Color.White)
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text("Video message", color = c.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(mmss(meta.duration ?: 0), color = c.textMuted, fontSize = 12.sp)
        }
    }

    path?.let { file ->
        Dialog(onDismissRequest = { path = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                AndroidView(
                    factory = { ctx ->
                        VideoView(ctx).apply {
                            setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
                            setVideoPath(file)
                            setOnPreparedListener { start() }
                            setOnErrorListener { _, _, _ ->
                                I18nToast.make(ctx, "This video can't be played.", Toast.LENGTH_SHORT).show()
                                path = null
                                true
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(320.dp)
                )
                Icon(
                    Icons.Outlined.Close, "Close", tint = Color.White,
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp).size(28.dp).clip(CircleShape).clickable { path = null }
                )
            }
        }
    }
}

/** Encrypts and sends a finished voice recording. */
suspend fun sendVoiceFile(file: File, seconds: Int, channelId: String) = withContext(Dispatchers.IO) {
    try {
        sendPrepared(channelId, file.readBytes(), "audio/mp4", "voice-message.m4a", "voice", durationSec = seconds)
    } finally {
        file.delete()
    }
}

/** Encrypts and sends a video recorded with the system camera (max 60 s, enforced by the capture intent). */
suspend fun sendVideoFile(file: File, channelId: String) = withContext(Dispatchers.IO) {
    try {
        val seconds = runCatching {
            val r = android.media.MediaMetadataRetriever()
            r.setDataSource(file.absolutePath)
            val ms = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            r.release()
            (ms / 1000).toInt()
        }.getOrDefault(0)
        sendPrepared(channelId, file.readBytes(), "video/mp4", "video-message.mp4", "video", durationSec = seconds)
    } finally {
        file.delete()
    }
}
