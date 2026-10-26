package com.nodetalk.client.ui.screens

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.nodetalk.client.CoveApp
import com.nodetalk.client.ui.components.I18nToast
import com.nodetalk.client.ui.components.Text
import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.CoveWhisperAccent
import com.nodetalk.client.ui.theme.CoveWhisperPrimary
import com.nodetalk.client.ui.theme.CoveWhisperTextMuted
import com.nodetalk.client.whisper.WhisperMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** Largest attachment a Whisper carries: the relay frame limit is 20 MB and base64 adds a third. */
const val WHISPER_MAX_BYTES = 10 * 1024 * 1024

/** "4:32" / "1:02:03" until a message disappears. */
internal fun formatRemaining(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s % 3600 / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/** Hands the decrypted attachment to the system viewer (image gallery, video player, document app). */
internal fun openWhisperFile(context: Context, m: WhisperMessage) {
    val f = m.file ?: return
    val file = CoveApp.instance.whisperManager.materialize(m) ?: return
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, f.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { context.startActivity(Intent.createChooser(intent, f.name)) }.onFailure { I18nToast.make(context, "No app can open this file.", android.widget.Toast.LENGTH_SHORT).show() }
}

/** Reads a picked file for sending, or null when it is unreadable or over [WHISPER_MAX_BYTES]. */
internal suspend fun readWhisperUri(context: Context, uri: Uri): Triple<ByteArray, String, String>? = withContext(Dispatchers.IO) {
    runCatching {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val name = resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "attachment"
        val bytes = resolver.openInputStream(uri)?.use { it.readNBytes(WHISPER_MAX_BYTES + 1) } ?: return@runCatching null
        if (bytes.size > WHISPER_MAX_BYTES) null else Triple(bytes, mime, name)
    }.getOrNull()
}

@Composable
private fun bubbleColors(mine: Boolean) = if (mine) Color.Black to CoveWhisperPrimary else CoveWhisperPrimary to CoveWhisperAccent

/** An image, video, voice note or document inside a Whisper bubble. */
@Composable
fun WhisperFileBubble(m: WhisperMessage, mine: Boolean) {
    val f = m.file ?: return
    val context = LocalContext.current
    val (fg, bg) = bubbleColors(mine)
    when {
        f.mime.startsWith("image/") -> {
            val bmp by remember(m.id) { mutableStateOf(decodeSampled(f.bytes, 720)) }
            bmp?.let {
                Image(
                    it.asImageBitmap(), f.name, contentScale = ContentScale.Fit,
                    modifier = Modifier.widthIn(max = 260.dp).clip(CoveShapes.md).clickable { openWhisperFile(context, m) }
                )
            } ?: FileRow(m, fg, bg) { openWhisperFile(context, m) }
        }
        f.kind == "voice" || f.mime.startsWith("audio/") -> WhisperVoice(m, fg, bg)
        f.kind == "video" || f.mime.startsWith("video/") -> {
            var thumb by remember(m.id) { mutableStateOf<Bitmap?>(null) }
            LaunchedEffect(m.id) {
                thumb = withContext(Dispatchers.IO) {
                    runCatching {
                        val file = CoveApp.instance.whisperManager.materialize(m) ?: return@runCatching null
                        MediaMetadataRetriever().run { setDataSource(file.absolutePath); getFrameAtTime(0).also { release() } }
                    }.getOrNull()
                }
            }
            Box(Modifier.widthIn(max = 260.dp).clip(CoveShapes.md).background(bg).clickable { openWhisperFile(context, m) }, contentAlignment = Alignment.Center) {
                thumb?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth()) } ?: Spacer(Modifier.size(width = 200.dp, height = 120.dp))
                Box(Modifier.size(52.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(30.dp))
                }
                f.duration?.let { Text(mmss(it), color = Color.White, fontSize = CoveType.caption.fontSize, modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp)) }
            }
        }
        else -> FileRow(m, fg, bg) { openWhisperFile(context, m) }
    }
}

@Composable
private fun FileRow(m: WhisperMessage, fg: Color, bg: Color, onClick: () -> Unit) {
    val f = m.file ?: return
    Row(Modifier.clip(CoveShapes.md).background(bg).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Description, null, tint = fg, modifier = Modifier.size(28.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.widthIn(max = 200.dp)) {
            Text(f.name, color = fg, fontSize = CoveType.body.fontSize, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            Text(formatBytes(f.size), color = fg.copy(alpha = 0.7f), fontSize = CoveType.caption.fontSize)
        }
    }
}

/** Voice note: play/pause, waveform with progress and the length. Decrypted bytes play from a temp file. */
@Composable
private fun WhisperVoice(m: WhisperMessage, fg: Color, bg: Color) {
    val f = m.file ?: return
    var player by remember(m.id) { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember(m.id) { mutableStateOf(false) }
    var position by remember(m.id) { mutableIntStateOf(0) }
    var length by remember(m.id) { mutableIntStateOf((f.duration ?: 0) * 1000) }
    DisposableEffect(m.id) { onDispose { runCatching { player?.release() } } }
    LaunchedEffect(playing) { while (playing) { position = runCatching { player?.currentPosition ?: 0 }.getOrDefault(0); delay(100) } }

    fun toggle() {
        val p = player
        if (p != null && playing) { p.pause(); playing = false; return }
        if (p != null) { p.start(); playing = true; return }
        val file = CoveApp.instance.whisperManager.materialize(m) ?: return
        val np = MediaPlayer().apply {
            setDataSource(file.absolutePath)
            setOnCompletionListener { playing = false; position = 0; it.seekTo(0) }
            prepare()
        }
        length = np.duration
        player = np
        np.start(); playing = true
    }

    Row(Modifier.clip(CoveShapes.md).background(bg).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(fg.copy(alpha = 0.15f)).clickable { toggle() }, contentAlignment = Alignment.Center) {
            Icon(if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (playing) "Pause" else "Play voice message", tint = fg, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.width(10.dp))
        val peaks = f.waveform?.takeIf { it.isNotEmpty() } ?: List(40) { 30 }
        val progress = if (length > 0) position.toFloat() / length else 0f
        Row(Modifier.width(140.dp).height(32.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
            val bars = 28
            for (i in 0 until bars) {
                val v = peaks[(i * peaks.size / bars).coerceAtMost(peaks.size - 1)].coerceIn(8, 100)
                val played = i.toFloat() / bars < progress
                Box(Modifier.weight(1f).height((32 * v / 100f).dp).clip(CircleShape).background(if (played) fg else fg.copy(alpha = 0.4f)))
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(mmss(((if (playing) position else length) / 1000)), color = fg.copy(alpha = 0.8f), fontSize = CoveType.caption.fontSize)
    }
}

private fun decodeSampled(bytes: ByteArray, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / sample > maxSide * 2 || bounds.outHeight / sample > maxSide * 2) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}
