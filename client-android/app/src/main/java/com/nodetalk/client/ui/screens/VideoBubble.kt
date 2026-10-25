package com.nodetalk.client.ui.screens

import android.graphics.BitmapFactory
import android.net.Uri
import android.view.LayoutInflater
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.nodetalk.client.R
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
 * Video message tile like web `VideoMessageBubble`: a 256dp square with 32dp corners that plays *in place* (no
 * separate screen). Idle it shows the blurred encrypted thumbnail with a primary play button; once playing it shows
 * a progress ring around the tile, a `0:02 / 0:05` pill, mute and fullscreen buttons. Tapping the video toggles
 * pause; fullscreen opens the same player with Media3's transport controls.
 */
@Composable
fun VideoBubble(channelId: String, meta: FileMeta, keyVersion: Int = 0) {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val shape = RoundedCornerShape(32.dp)

    var loading by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<ExoPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var ended by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    var fullscreen by remember { mutableStateOf(false) }
    var positionMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf((meta.duration ?: 0) * 1000L) }
    var inlineView by remember { mutableStateOf<PlayerView?>(null) }

    val thumb = remember(meta.fileId, keyVersion) {
        decryptPreview(channelId, meta)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
    }

    DisposableEffect(meta.fileId) { onDispose { player?.release(); player = null } }
    LaunchedEffect(playing) {
        while (playing) {
            player?.let { positionMs = it.currentPosition; if (it.duration > 0) durationMs = it.duration }
            delay(100)
        }
    }

    fun start() {
        loading = true
        scope.launch {
            val data = loadAttachment(channelId, meta)
            if (data == null) {
                I18nToast.make(context, "Couldn't load the video message.", android.widget.Toast.LENGTH_SHORT).show()
                loading = false
                return@launch
            }
            val ext = if (meta.mime.contains("webm")) "webm" else "mp4"
            val f = File(context.cacheDir, "attachments").apply { mkdirs() }.let { File(it, "video_${meta.fileId}.$ext") }
            withContext(Dispatchers.IO) { f.writeBytes(data) }
            val p = ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(Uri.fromFile(f)))
                addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
                    override fun onPlaybackStateChanged(state: Int) {
                        if (state == Player.STATE_ENDED) { ended = true; playing = false }
                        if (state == Player.STATE_READY && duration > 0) durationMs = duration
                    }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        I18nToast.make(context, "This video can't be played.", android.widget.Toast.LENGTH_SHORT).show()
                        player = null
                        release()
                    }
                })
                prepare()
                playWhenReady = true
            }
            player = p
            loading = false
        }
    }

    fun toggle() {
        val p = player
        when {
            p == null -> start()
            ended -> { ended = false; p.seekTo(0); p.play() }
            p.isPlaying -> p.pause()
            else -> p.play()
        }
    }

    Box(
        Modifier
            .padding(vertical = 4.dp)
            .size(256.dp)
            .clip(shape)
            .background(Color.Black)
            .border(1.dp, c.border.copy(alpha = 0.5f), shape)
            .clickable(enabled = !loading) { toggle() },
        contentAlignment = Alignment.Center
    ) {
        // Idle backdrop (also visible until the first video frame renders)
        if (thumb != null) {
            Image(thumb.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().blur(12.dp))
        } else {
            Box(Modifier.fillMaxSize().background(c.card.copy(alpha = 0.8f)))
        }

        player?.let { p ->
            AndroidView(
                factory = { ctx ->
                    (LayoutInflater.from(ctx).inflate(R.layout.view_player_texture, null, false) as PlayerView).also {
                        it.player = p
                        inlineView = it
                    }
                },
                update = { if (!fullscreen) it.player = p },
                modifier = Modifier.fillMaxSize()
            )
        }

        // Progress ring along the rounded edge (web uses an SVG stroke around the tile)
        val fraction = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
        if (player != null) {
            Canvas(Modifier.fillMaxSize()) {
                val sw = 4.dp.toPx()
                val path = Path().apply {
                    addRoundRect(RoundRect(sw / 2, sw / 2, size.width - sw / 2, size.height - sw / 2, CornerRadius(32.dp.toPx() - sw / 2)))
                }
                drawPath(path, Color.Black.copy(alpha = 0.3f), style = Stroke(sw))
                val measure = PathMeasure().apply { setPath(path, false) }
                val seg = Path()
                measure.getSegment(0f, measure.length * fraction, seg, true)
                drawPath(seg, NTPrimary, style = Stroke(sw, cap = StrokeCap.Round))
            }
        }

        if (loading || !playing) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(NTPrimary.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
                if (loading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                else Icon(if (ended) Icons.Rounded.PlayArrow else Icons.Rounded.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(30.dp))
            }
        }

        Row(
            Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
        ) {
            val time = if (player != null) "${mmss((positionMs / 1000).toInt())} / ${mmss((durationMs / 1000).toInt())}" else mmss((durationMs / 1000).toInt())
            Text(
                time, color = Color.White.copy(alpha = 0.9f), fontSize = 11.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).border(1.dp, Color.White.copy(alpha = 0.1f), CircleShape).padding(horizontal = 10.dp, vertical = 2.dp)
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (player != null) {
                    RoundIconButton(if (muted) Icons.Outlined.VolumeOff else Icons.Outlined.VolumeUp, if (muted) "Unmute" else "Mute") {
                        muted = !muted
                        player?.volume = if (muted) 0f else 1f
                    }
                    RoundIconButton(Icons.Outlined.Fullscreen, "Fullscreen") { fullscreen = true }
                } else {
                    RoundIconButton(Icons.Outlined.FileDownload, "Download") { scope.launch { openAttachment(context, channelId, meta) } }
                }
            }
        }
    }

    val active = player
    if (fullscreen && active != null) {
        Dialog(onDismissRequest = { fullscreen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                AndroidView(
                    factory = { ctx ->
                        val full = LayoutInflater.from(ctx).inflate(R.layout.view_player_fullscreen, null, false) as PlayerView
                        PlayerView.switchTargetView(active, inlineView, full)
                        full
                    },
                    onRelease = { full -> inlineView?.let { PlayerView.switchTargetView(active, full, it) } },
                    modifier = Modifier.fillMaxSize()
                )
                Icon(
                    Icons.Outlined.Close, "Close", tint = Color.White,
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp).size(32.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.5f)).padding(4.dp).clickable { fullscreen = false }
                )
            }
        }
    }
}

@Composable
private fun RoundIconButton(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, onClick: () -> Unit) {
    Box(
        Modifier.size(28.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).border(1.dp, Color.White.copy(alpha = 0.1f), CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Icon(icon, desc, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(14.dp)) }
}
