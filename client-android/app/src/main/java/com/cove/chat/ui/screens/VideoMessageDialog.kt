package com.cove.chat.ui.screens

import android.Manifest
import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Rational
import android.view.LayoutInflater
import android.view.Surface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.ViewPort
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ContentCut
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FlipCameraAndroid
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.rounded.Close
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.cove.chat.R
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.ceil

private enum class VideoMode { Idle, Recording, Preview }

/** Neutral tick heights for the video trim bar (video has no waveform), like the web recorder. */
private val TickBars = ByteArray(40) { 60 }

private val FrameShape = RoundedCornerShape(44.dp)
private val Overlay = Color.White

private fun hasCameraPermissions(context: Context) =
    listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        .all { ContextCompat.checkSelfPermission(context, it) == android.content.pm.PackageManager.PERMISSION_GRANTED }

private suspend fun Context.cameraProvider(): ProcessCameraProvider = suspendCancellableCoroutine { cont ->
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
        runCatching { future.get() }.onSuccess { cont.resume(it) }.onFailure { cont.resumeWithException(it) }
    }, ContextCompat.getMainExecutor(this))
}

/**
 * Full-screen "video message" recorder, the native counterpart of the web recorder: a square rounded camera frame with
 * a draining countdown ring and a pill showing the time left, a camera flip, a record / stop button, then a looping
 * preview where the clip can be trimmed before it is sent. The video is recorded square so it fills the round
 * message bubble. The camera stops as soon as the take finishes or the dialog closes.
 *
 * @param maxSeconds recording limit (60 s in chats, 30 s in Whisper).
 * @param onSend receives the final file (trimmed if the user cut it); the caller sends it and deletes it afterwards.
 */
@Composable
fun VideoMessageDialog(maxSeconds: Int = 60, onDismiss: () -> Unit, onSend: (File) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val palette = chatComposerPalette()
    val primary = MaterialTheme.colorScheme.primary
    val error = MaterialTheme.colorScheme.error

    var mode by remember { mutableStateOf(VideoMode.Idle) }
    var granted by remember { mutableStateOf(hasCameraPermissions(context)) }
    var facingFront by remember { mutableStateOf(true) }
    var hasBothCameras by remember { mutableStateOf(false) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var elapsedMs by remember { mutableStateOf(0L) }
    var file by remember { mutableStateOf<File?>(null) }
    var totalMs by remember { mutableStateOf(1000L) }
    var busy by remember { mutableStateOf(false) }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var capture by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var recording by remember { mutableStateOf<Recording?>(null) }
    var startF by remember { mutableStateOf(0f) }
    var endF by remember { mutableStateOf(1f) }
    var position by remember { mutableStateOf(0f) }
    var playing by remember { mutableStateOf(true) }
    val previewView = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE; scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val providerNow by rememberUpdatedState(provider)
    val recordingNow by rememberUpdatedState(recording)
    fun toast(msg: String) = I18nToast.make(context, msg, android.widget.Toast.LENGTH_SHORT).show()

    val askPermissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted = it.values.all { ok -> ok } }
    LaunchedEffect(Unit) {
        if (!granted) askPermissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
    }
    LaunchedEffect(Unit) {
        provider = runCatching { context.cameraProvider() }.onFailure { cameraError = it.message }.getOrNull()
    }
    // The camera must never outlive the dialog.
    DisposableEffect(Unit) {
        onDispose {
            runCatching { recordingNow?.stop() }
            runCatching { providerNow?.unbindAll() }
        }
    }

    // (Re)bind the camera while framing a take; release it while previewing one.
    LaunchedEffect(provider, granted, facingFront, mode == VideoMode.Preview) {
        val p = provider ?: return@LaunchedEffect
        if (mode == VideoMode.Preview) { p.unbindAll(); return@LaunchedEffect }
        if (!granted || mode == VideoMode.Recording) return@LaunchedEffect
        hasBothCameras = p.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) && p.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)
        val selector = if (facingFront && p.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val recorder = Recorder.Builder()
            .setQualitySelector(QualitySelector.from(Quality.SD, FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)))
            .build()
        val videoCapture = VideoCapture.withOutput(recorder)
        // A 1:1 viewport crops both the preview and the recorded file to a square, so the clip fills the round bubble.
        val group = UseCaseGroup.Builder()
            .addUseCase(preview).addUseCase(videoCapture)
            .setViewPort(ViewPort.Builder(Rational(1, 1), previewView.display?.rotation ?: Surface.ROTATION_0).build())
            .build()
        runCatching { p.unbindAll(); p.bindToLifecycle(owner, selector, group) }
            .onSuccess { capture = videoCapture; cameraError = null }
            .onFailure { cameraError = it.message ?: "Couldn't open the camera." }
    }

    fun resetTake() {
        file?.delete(); file = null
        elapsedMs = 0; startF = 0f; endF = 1f; position = 0f; playing = true; busy = false
        mode = VideoMode.Idle
    }
    fun cancel() { resetTake(); onDismiss() }

    fun startRecording() {
        val cap = capture ?: return
        val out = File(File(context.cacheDir, "video").apply { mkdirs() }, "vid_${System.currentTimeMillis()}.mp4")
        file = out
        elapsedMs = 0
        recording = cap.output.prepareRecording(context, FileOutputOptions.Builder(out).build())
            .withAudioEnabled()
            .start(ContextCompat.getMainExecutor(context)) { ev ->
                when (ev) {
                    is VideoRecordEvent.Status -> {
                        elapsedMs = ev.recordingStats.recordedDurationNanos / 1_000_000
                        if (elapsedMs >= maxSeconds * 1000L) recording?.stop()
                    }
                    is VideoRecordEvent.Finalize -> {
                        recording = null
                        if (ev.hasError() && out.length() == 0L) { toast("Couldn't record the video."); out.delete(); file = null; mode = VideoMode.Idle }
                        else {
                            totalMs = runCatching {
                                val r = MediaMetadataRetriever().apply { setDataSource(out.absolutePath) }
                                (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: elapsedMs).also { r.release() }
                            }.getOrDefault(elapsedMs).coerceAtLeast(1000L)
                            mode = VideoMode.Preview
                        }
                    }
                    else -> Unit
                }
            }
        mode = VideoMode.Recording
    }

    fun send() {
        val f = file ?: return
        busy = true
        scope.launch {
            val out = if (AudioTrim.isFullRange(startF, endF)) f else withContext(Dispatchers.IO) {
                val dst = File(f.parentFile, "vid_trim_${System.currentTimeMillis()}.mp4")
                if (MediaTrim.trimMp4(f, dst, (startF * totalMs * 1000).toLong(), (endF * totalMs * 1000).toLong())) { f.delete(); dst } else f
            }
            file = null
            onSend(out)
        }
    }

    Dialog(onDismissRequest = ::cancel, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f))) {
            Column(Modifier.fillMaxSize().systemBarsPadding().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                val frame = minOf(LocalConfiguration.current.screenWidthDp - 32, 384).dp
                Row(Modifier.width(frame), horizontalArrangement = Arrangement.End) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(Overlay.copy(alpha = 0.12f)).clickable(enabled = !busy, onClick = ::cancel), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.Close, "Close", tint = Overlay, modifier = Modifier.size(20.dp))
                    }
                }
                Spacer(Modifier.height(8.dp))

                // ── the frame ────────────────────────────────────────────────
                Box(Modifier.size(frame).clip(FrameShape).border(2.dp, Overlay.copy(alpha = 0.15f), FrameShape).background(Color.Black)) {
                    val timeLeftMs = (maxSeconds * 1000L - elapsedMs).coerceAtLeast(0L)
                    if (mode != VideoMode.Preview) {
                        AndroidView({ previewView }, Modifier.fillMaxSize())
                    } else file?.let { f ->
                        val player = remember(f) {
                            ExoPlayer.Builder(context).build().apply {
                                setMediaItem(MediaItem.fromUri(Uri.fromFile(f)))
                                repeatMode = Player.REPEAT_MODE_OFF
                                prepare(); playWhenReady = true
                            }
                        }
                        DisposableEffect(player) {
                            val l = object : Player.Listener { override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying } }
                            player.addListener(l)
                            onDispose { player.removeListener(l); player.release() }
                        }
                        // Loop inside the trim range and mirror the playhead onto the bar.
                        LaunchedEffect(player, startF, endF) {
                            player.seekTo((startF * totalMs).toLong())
                            while (true) {
                                val pos = player.currentPosition
                                position = pos.toFloat() / totalMs
                                if (pos >= endF * totalMs || player.playbackState == Player.STATE_ENDED) { player.seekTo((startF * totalMs).toLong()); player.play() }
                                delay(40)
                            }
                        }
                        AndroidView(
                            factory = { ctx ->
                                (LayoutInflater.from(ctx).inflate(R.layout.view_player_texture, null, false) as PlayerView).also {
                                    it.useController = false
                                    it.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                                    it.player = player
                                }
                            },
                            Modifier.fillMaxSize().clickable { if (player.isPlaying) player.pause() else player.play() }
                        )
                        if (!playing) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.3f)), contentAlignment = Alignment.Center) {
                            Box(Modifier.size(48.dp).clip(CircleShape).background(primary.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PlayArrow, "Play", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(28.dp))
                            }
                        }
                    }

                    if (mode == VideoMode.Recording) {
                        // Countdown ring that drains as time runs out, following the frame's rounded corners.
                        Canvas(Modifier.fillMaxSize()) {
                            val stroke = 6.dp.toPx()
                            val path = Path().apply {
                                addRoundRect(RoundRect(stroke / 2, stroke / 2, size.width - stroke / 2, size.height - stroke / 2, CornerRadius(44.dp.toPx() - stroke / 2)))
                            }
                            drawPath(path, Overlay.copy(alpha = 0.15f), style = Stroke(stroke))
                            val measure = PathMeasure().apply { setPath(path, false) }
                            val part = Path()
                            measure.getSegment(0f, measure.length * (timeLeftMs / (maxSeconds * 1000f)).coerceIn(0f, 1f), part, true)
                            drawPath(part, primary, style = Stroke(stroke, cap = StrokeCap.Round))
                        }
                        val pulse by rememberInfiniteTransition(label = "recPulse").animateFloat(1f, 0.3f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "dot")
                        Row(
                            Modifier.align(Alignment.TopCenter).padding(top = 14.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 12.dp, vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(Modifier.size(8.dp).alpha(pulse).clip(CircleShape).background(error))
                            Spacer(Modifier.width(6.dp))
                            val left = ceil(timeLeftMs / 1000f).toInt()
                            androidx.compose.material3.Text("%d:%02d".format(left / 60, left % 60), color = Overlay, fontSize = 12.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                        }
                    }

                    if (mode == VideoMode.Idle && hasBothCameras && granted) {
                        Box(
                            Modifier.align(Alignment.TopEnd).padding(14.dp).size(40.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)).clickable { facingFront = !facingFront },
                            contentAlignment = Alignment.Center
                        ) { Icon(Icons.Outlined.FlipCameraAndroid, "Switch camera", tint = Overlay, modifier = Modifier.size(20.dp)) }
                    }

                    if (!granted || cameraError != null) {
                        Column(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.8f)).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            Icon(Icons.Outlined.ErrorOutline, null, tint = error, modifier = Modifier.size(32.dp))
                            Spacer(Modifier.height(8.dp))
                            Text("Camera access denied", color = error, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                if (!granted) "Allow camera and microphone access to record a video message." else cameraError.orEmpty(),
                                color = Overlay.copy(alpha = 0.7f), fontSize = 12.sp, textAlign = TextAlign.Center
                            )
                            if (!granted) Text(
                                "Allow access", color = primary, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.clickable { askPermissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) }.padding(12.dp)
                            )
                        }
                    }
                }
                Spacer(Modifier.height(18.dp))

                // ── controls ─────────────────────────────────────────────────
                Column(Modifier.width(frame), horizontalAlignment = Alignment.CenterHorizontally) {
                    when (mode) {
                        VideoMode.Idle -> {
                            Box(
                                Modifier.size(64.dp).clip(CircleShape).background(error).clickable(enabled = granted && capture != null, onClick = ::startRecording),
                                contentAlignment = Alignment.Center
                            ) { Box(Modifier.size(24.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onError)) }
                            Spacer(Modifier.height(8.dp))
                            Text("Tap to record", color = Overlay.copy(alpha = 0.8f), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                        VideoMode.Recording -> {
                            Box(
                                Modifier.size(64.dp).clip(CircleShape).background(error).clickable { recording?.stop() },
                                contentAlignment = Alignment.Center
                            ) { Box(Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).background(MaterialTheme.colorScheme.onError)) }
                            Spacer(Modifier.height(8.dp))
                            Text("Recording", color = error, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                        VideoMode.Preview -> Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Overlay.copy(alpha = 0.08f)).border(1.dp, Overlay.copy(alpha = 0.1f), RoundedCornerShape(16.dp)).padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.ContentCut, null, tint = primary, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Trim", color = Overlay.copy(alpha = 0.7f), fontSize = 11.sp, fontWeight = FontWeight.Medium)
                                }
                                val s = (startF * totalMs / 1000).toInt()
                                val e = ceil(endF * totalMs / 1000f).toInt()
                                androidx.compose.material3.Text("${mmss(s)} - ${mmss(e)} (${AudioTrim.trimmedSeconds(totalMs, startF, endF)}s)", color = Overlay.copy(alpha = 0.9f), fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            }
                            TrimBar(
                                bars = TickBars, start = startF, end = endF, position = position, minGap = AudioTrim.minGapFraction(totalMs),
                                palette = palette, modifier = Modifier.fillMaxWidth().height(40.dp),
                                onTrim = { s, e -> startF = s; endF = e },
                                onSeek = { f -> position = f.coerceIn(startF, endF) }
                            )
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Row(
                                    Modifier.clip(RoundedCornerShape(12.dp)).background(Overlay.copy(alpha = 0.1f)).clickable(enabled = !busy) { resetTake() }.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Outlined.Replay, null, tint = Overlay, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Retake", color = Overlay, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Cancel", color = Overlay.copy(alpha = 0.7f), fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clickable(enabled = !busy, onClick = ::cancel).padding(12.dp))
                                    Row(
                                        Modifier.clip(RoundedCornerShape(12.dp)).background(primary).clickable(enabled = !busy, onClick = ::send).padding(horizontal = 16.dp, vertical = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        if (busy) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                                        else Icon(Icons.AutoMirrored.Outlined.Send, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("Send", color = MaterialTheme.colorScheme.onPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
