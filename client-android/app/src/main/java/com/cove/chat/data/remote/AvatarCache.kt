package com.nodetalk.client.data.remote

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import com.nodetalk.client.CoveApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * In-memory cache of profile photos (plain files, not channel-encrypted), mirroring the web `avatarCache`.
 * A failed lookup is remembered so a missing avatar doesn't trigger a request per recomposition.
 */
object AvatarCache {
    private val cache = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val failed = HashSet<String>()
    private val mutex = Mutex()

    fun peek(id: String): Bitmap? = cache.get(id)

    suspend fun load(id: String): Bitmap? {
        cache.get(id)?.let { return it }
        return mutex.withLock {
            cache.get(id)?.let { return@withLock it }
            if (id in failed) return@withLock null
            val bytes = CoveApp.instance.apiClient.downloadFile(id).getOrNull()
            val bmp = bytes?.let {
                withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
            if (bmp != null) cache.put(id, bmp) else failed.add(id)
            bmp
        }
    }

    /** Forget a cached avatar (after the user replaced their photo). */
    fun invalidate(id: String) {
        cache.remove(id)
        failed.remove(id)
    }
}
