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
import com.nodetalk.client.ui.theme.CoveTheme
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

internal fun mmss(seconds: Int) = "%d:%02d".format(seconds / 60, seconds % 60)

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
