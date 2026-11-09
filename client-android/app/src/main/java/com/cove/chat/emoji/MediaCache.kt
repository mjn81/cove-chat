package com.cove.chat.emoji

import android.graphics.BitmapFactory
import android.os.Build
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import com.cove.chat.CoveApp
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Disk and memory cache for server images that are the same for everybody and never change (sticker images, custom
 * emoji, animated emoji): their URLs carry a content version or an unguessable id, so a cached copy is never stale.
 * Requests go through [com.cove.chat.data.remote.ApiClient.getBytes] so the Bearer session is attached.
 */
object MediaCache {
    private val memory = LruCache<String, ImageBitmap>(96)
    private val inflight = java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.Deferred<ByteArray?>>()

    private fun file(path: String): File {
        val dir = File(CoveApp.instance.cacheDir, "media").apply { mkdirs() }
        val sha = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, sha)
    }

    /** The file's bytes from disk, else the network (then stored). Null when it cannot be fetched. */
    suspend fun bytes(path: String): ByteArray? = withContext(Dispatchers.IO) {
        val f = file(path)
        if (f.isFile && f.length() > 0) return@withContext runCatching { f.readBytes() }.getOrNull()
        val data = CoveApp.instance.apiClient.getBytes(path).getOrNull() ?: return@withContext null
        runCatching { f.writeBytes(data) }
        data
    }

    /** First frame (or the only frame) as a bitmap, cached in memory. */
    suspend fun image(path: String): ImageBitmap? {
        memory.get(path)?.let { return it }
        val bytes = bytes(path) ?: return null
        val bmp = withContext(Dispatchers.Default) { runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull() } ?: return null
        return bmp.asImageBitmap().also { memory.put(path, it) }
    }

    fun cachedImage(path: String): ImageBitmap? = memory.get(path)

    /** Deletes every cached image (Settings > Data & Storage). */
    fun clear() { memory.evictAll(); File(CoveApp.instance.cacheDir, "media").deleteRecursively() }
}

/** A static server image (sticker, custom emoji) that loads in the background and shows nothing while it does. */
@Composable
fun ServerImage(path: String, contentDescription: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Fit) {
    val img by produceState(MediaCache.cachedImage(path), path) { if (value == null) value = MediaCache.image(path) }
    img?.let { Image(it, contentDescription, modifier, contentScale = contentScale) }
}

/**
 * An animated WebP (sticker, animated emoji). API 28+ plays it with the platform's `AnimatedImageDrawable`; older
 * devices show the first frame. [loopForever] false plays once and a tap replays it (big emoji); true loops (stickers).
 */
@Composable
fun AnimatedServerImage(path: String, contentDescription: String?, modifier: Modifier = Modifier, loopForever: Boolean = true, replayOnTap: Boolean = false) {
    val data by produceState<ByteArray?>(null, path) { value = MediaCache.bytes(path) }
    val bytes = data
    if (bytes == null) {
        ServerImage(path, contentDescription, modifier)
        return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
        ServerImage(path, contentDescription, modifier)
        return
    }
    var drawable by remember(path) { mutableStateOf<android.graphics.drawable.Drawable?>(null) }
    LaunchedEffect(bytes) {
        drawable = withContext(Dispatchers.Default) {
            runCatching {
                android.graphics.ImageDecoder.decodeDrawable(android.graphics.ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes)))
            }.getOrNull()
        }
    }
    val d = drawable
    if (d == null) { ServerImage(path, contentDescription, modifier); return }
    val tap = if (replayOnTap) Modifier.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
        (d as? android.graphics.drawable.AnimatedImageDrawable)?.let { it.stop(); it.start() }
    } else Modifier
    AndroidView(
        factory = { ctx ->
            android.widget.ImageView(ctx).apply {
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                this.contentDescription = contentDescription
            }
        },
        update = { view ->
            view.setImageDrawable(d)
            (d as? android.graphics.drawable.AnimatedImageDrawable)?.let {
                it.repeatCount = if (loopForever) android.graphics.drawable.AnimatedImageDrawable.REPEAT_INFINITE else 0
                it.start()
            }
        },
        modifier = modifier.then(tap),
    )
}

