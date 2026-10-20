package com.nodetalk.client.ui.screens

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import android.util.LruCache
import android.widget.Toast
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.github.luben.zstd.Zstd
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.crypto.CryptoManager
import com.nodetalk.client.data.model.FileMeta
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.io.File

private const val MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
private val metaJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

/** Decoded-image cache keyed by file id so scrolling doesn't re-download and re-decrypt. */
private val imageCache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
}

private fun displayName(context: Context, uri: Uri): String =
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    } ?: "file"

/** Downscales (max 1920px) and re-encodes as WebP like the web client's `compressImageFile`; keeps the original if not smaller. */
private fun compressImage(bytes: ByteArray): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 3840) sample *= 2
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val scale = minOf(1f, 1920f / maxOf(bmp.width, bmp.height))
    val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
    val out = ByteArrayOutputStream()
    val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
    scaled.compress(format, 82, out)
    return out.toByteArray().takeIf { it.size < bytes.size }
}

/**
 * Compress (zstd) -> encrypt (AES-256-GCM with the channel key) -> upload -> send a `file` message
 * whose body is the JSON metadata. Mirrors `ChatInputArea` + `encryptAndCompressFile` in client-web.
 * [asPhoto] re-encodes images to WebP; otherwise bytes are sent untouched.
 */
suspend fun sendAttachment(context: Context, uri: Uri, channelId: String, asPhoto: Boolean): Result<Unit> = withContext(Dispatchers.IO) {
    runCatching {
        val app = NodeTalkApp.instance
        val resolver = context.contentResolver
        var bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Couldn't read the selected file.")
        if (bytes.size > MAX_ATTACHMENT_BYTES) error("File is too large for mobile (max 25 MB).")
        var mime = resolver.getType(uri) ?: "application/octet-stream"
        var name = displayName(context, uri)
        if (asPhoto && mime.startsWith("image/") && mime != "image/gif") {
            compressImage(bytes)?.let {
                bytes = it
                mime = "image/webp"
                name = name.substringBeforeLast('.') + ".webp"
            }
        }
        val originalSize = bytes.size.toLong()
        val compressed = if (mime.startsWith("audio/")) bytes else Zstd.compress(bytes, 10)
        val (cipher, nonce) = CryptoManager.encryptBytes(channelId, compressed) ?: error("Channel key not available yet. Try again in a moment.")
        val uploaded = app.apiClient.uploadFile(cipher, mime, channelId).getOrThrow()
        val meta = FileMeta(
            fileId = uploaded.id, name = name, mime = mime, size = originalSize,
            nonce = Base64.encodeToString(nonce, Base64.NO_WRAP),
            asDocument = if (asPhoto) null else true
        )
        val ok = app.webSocketManager.sendChatMessage(channelId, metaJson.encodeToString(meta), type = "file", compression = "zstd")
        if (!ok) error("Not connected. Try again.")
    }
}

/** Downloads and decrypts (then inflates) an attachment; null on any failure (wrong key, missing file...). */
suspend fun loadAttachment(channelId: String, meta: FileMeta): ByteArray? = withContext(Dispatchers.IO) {
    val dl = NodeTalkApp.instance.apiClient.downloadFile(meta.fileId)
    val blob = dl.getOrNull() ?: run { android.util.Log.e("Attach", "download failed", dl.exceptionOrNull()); return@withContext null }
    val nonce = runCatching { Base64.decode(meta.nonce, Base64.NO_WRAP) }.getOrNull() ?: run { android.util.Log.e("Attach", "bad nonce"); return@withContext null }
    val plain = CryptoManager.decryptBytes(channelId, blob, nonce) ?: run { android.util.Log.e("Attach", "decrypt failed blob=${blob.size} key=${CryptoManager.getChannelKey(channelId) != null}"); return@withContext null }
    if (meta.mime.startsWith("audio/")) return@withContext plain
    runCatching {
        val size = Zstd.decompressedSize(plain).takeIf { it > 0 } ?: meta.size
        Zstd.decompress(plain, size.toInt())
    }.onFailure { android.util.Log.e("Attach", "zstd failed", it) }.getOrNull()
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1 shl 20 -> "%.1f MB".format(bytes / 1048576.0)
    bytes >= 1 shl 10 -> "%.0f KB".format(bytes / 1024.0)
    else -> "$bytes B"
}

/** Inline image or file card for a decrypted `file` message. */
@Composable
fun FileBubble(channelId: String, meta: FileMeta, keyVersion: Int) {
    val c = NodeTalkTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val isImage = meta.mime.startsWith("image/") && !meta.mime.contains("svg")
    var bitmap by remember(meta.fileId) { mutableStateOf(imageCache.get(meta.fileId)) }
    var failed by remember(meta.fileId) { mutableStateOf(false) }
    var viewer by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    if (isImage) {
        LaunchedEffect(meta.fileId, keyVersion) {
            if (bitmap == null) {
                val data = loadAttachment(channelId, meta)
                val bmp = data?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
                if (bmp != null) { imageCache.put(meta.fileId, bmp); bitmap = bmp } else failed = true
            }
        }
        Box(
            Modifier
                .padding(top = 4.dp)
                .heightIn(max = 260.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(c.card)
                .clickable(enabled = bitmap != null) { viewer = true },
            contentAlignment = Alignment.Center
        ) {
            val b = bitmap
            when {
                b != null -> Image(b.asImageBitmap(), meta.name, contentScale = ContentScale.Fit, modifier = Modifier.heightIn(max = 260.dp))
                failed -> Text("Couldn't load image", color = c.textMuted, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
                else -> Box(Modifier.size(width = 200.dp, height = 120.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = NTPrimary, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                }
            }
        }
        if (viewer && bitmap != null) {
            Dialog(onDismissRequest = { viewer = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.92f)).clickable { viewer = false }, contentAlignment = Alignment.Center) {
                    Image(bitmap!!.asImageBitmap(), meta.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth())
                    Icon(Icons.Outlined.Close, "Close", tint = Color.White, modifier = Modifier.align(Alignment.TopEnd).padding(16.dp).size(26.dp))
                }
            }
        }
    } else {
        Row(
            Modifier
                .padding(top = 4.dp)
                .fillMaxWidth(0.9f)
                .clip(RoundedCornerShape(6.dp))
                .border(1.dp, c.border, RoundedCornerShape(6.dp))
                .background(c.card)
                .clickable(enabled = !busy) {
                    busy = true
                    scope.launch {
                        val data = loadAttachment(channelId, meta)
                        busy = false
                        if (data == null) {
                            Toast.makeText(context, "Couldn't download or decrypt the file.", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        // Written to the app cache only on demand, then handed to a viewer via FileProvider.
                        val dir = File(context.cacheDir, "attachments").apply { mkdirs() }
                        val file = File(dir, meta.name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
                        withContext(Dispatchers.IO) { file.writeBytes(data) }
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, meta.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        runCatching { context.startActivity(Intent.createChooser(view, meta.name)) }
                            .onFailure { Toast.makeText(context, "No app can open this file.", Toast.LENGTH_SHORT).show() }
                    }
                }
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (busy) CircularProgressIndicator(color = NTPrimary, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            else Icon(Icons.Outlined.InsertDriveFile, null, tint = NTPrimary, modifier = Modifier.size(28.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(meta.name, color = c.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(formatSize(meta.size), color = c.textMuted, fontSize = 12.sp)
            }
        }
    }
}

/** Drops decoded attachment images held in memory (used by Settings > Data & Storage). */
fun clearImageCache() = imageCache.evictAll()
