package com.cove.chat.data.local

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * Decrypted message bodies kept between runs so a cold start can draw the chat list and the last messages at once,
 * before the socket has delivered the channel keys (the Android counterpart of web commit ab379a9). Keys are
 * `channelId:nonce`: a nonce is unique per ciphertext, so an edited message is a new entry and a stale body is never
 * shown for new content. Bounded LRU; pure Kotlin so it is unit tested. The file lives in `cacheDir`, which sign-out wipes.
 */
class BodyCache(private val max: Int = 1500, private val maxBodyChars: Int = 4000) {
    private val map = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > max
    }
    @Volatile var dirty = false
        private set

    @Synchronized fun get(key: String): String? = map[key]

    /** Stores a successfully decrypted body; long bodies and failure placeholders are not worth keeping. */
    @Synchronized fun put(key: String, body: String) {
        if (body.length > maxBodyChars || body == "[encrypted]" || body == "[decryption failed]") return
        if (map[key] == body) return
        map[key] = body
        dirty = true
    }

    @Synchronized fun size() = map.size
    @Synchronized fun clear() { map.clear(); dirty = false }

    /** Serialises oldest-first, so reloading keeps the recency order. */
    @Synchronized fun toJson(): String {
        dirty = false
        return buildJsonObject { map.forEach { (k, v) -> put(k, v) } }.toString()
    }

    /** Loads a saved file; malformed input is ignored (the cache is only an accelerator). */
    @Synchronized fun loadJson(text: String) {
        val o = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        for ((k, v) in o) { val s = (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue; map[k] = s }
        dirty = false
    }

    companion object {
        fun key(channelId: String, nonce: String) = "$channelId:$nonce"
    }
}
