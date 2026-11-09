package com.cove.chat.data.local

import android.content.Context
import com.cove.chat.crypto.CryptoManager
import com.cove.chat.data.model.Channel
import com.cove.chat.data.model.Message
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Cold-start cache: the last channel list, the last page of messages per chat and the decrypted bodies, all in
 * `cacheDir` (wiped on sign-out by [LocalData.wipe]). The UI reads it synchronously (a few KB) to draw at once, then
 * refreshes from the network in parallel and writes the fresh data back off the main thread. Nothing here holds
 * channel keys; those still only arrive over the authenticated socket.
 */
object ClientCache {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val bodies = BodyCache()
    private var dir: File? = null
    private var saveJob: Job? = null
    private const val MESSAGES_PER_CHAT = 50

    /** Opens the cache and loads saved bodies in the background. Call from `Application.onCreate`. */
    fun init(context: Context) {
        dir = File(context.cacheDir, "cove").apply { mkdirs() }
        CryptoManager.bodyCache = bodies
        scope.launch { runCatching { File(dir, "bodies.json").takeIf { it.isFile }?.readText()?.let(bodies::loadJson) } }
        CryptoManager.onBodyCached = ::scheduleSave
    }

    private fun scheduleSave() {
        if (saveJob?.isActive == true) return
        saveJob = scope.launch {
            delay(3000)
            if (bodies.dirty) runCatching { File(dir ?: return@launch, "bodies.json").writeText(bodies.toJson()) }
        }
    }

    /** The saved channel list, or null on a first run. Synchronous on purpose: it is small and drawn immediately. */
    fun readChannels(): List<Channel>? = runCatching {
        File(dir ?: return null, "channels.json").takeIf { it.isFile }?.readText()?.let { json.decodeFromString(ListSerializer(Channel.serializer()), it) }
    }.getOrNull()

    fun writeChannels(list: List<Channel>) {
        val d = dir ?: return
        scope.launch { runCatching { File(d, "channels.json").writeText(json.encodeToString(ListSerializer(Channel.serializer()), list)) } }
    }

    private fun messageFile(channelId: String): File? =
        dir?.let { File(it, "m-" + channelId.filter { c -> c.isLetterOrDigit() || c == '-' || c == '_' }.take(64) + ".json") }

    /** Newest-first last page of [channelId], or null when never opened. */
    fun readMessages(channelId: String): List<Message>? = runCatching {
        messageFile(channelId)?.takeIf { it.isFile }?.readText()?.let { json.decodeFromString(ListSerializer(Message.serializer()), it) }
    }.getOrNull()

    fun writeMessages(channelId: String, newestFirst: List<Message>) {
        val f = messageFile(channelId) ?: return
        val page = newestFirst.take(MESSAGES_PER_CHAT)
        scope.launch { runCatching { f.writeText(json.encodeToString(ListSerializer(Message.serializer()), page)) } }
    }

    /** Forgets everything held in memory (sign-out; the files go with `cacheDir`). */
    fun clearMemory() { bodies.clear() }
}
