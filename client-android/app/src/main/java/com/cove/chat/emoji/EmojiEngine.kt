package com.cove.chat.emoji

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.cove.chat.CoveApp
import com.cove.chat.data.local.PreferencesManager
import com.cove.chat.data.model.AnimatedEmojiResponse
import com.cove.chat.data.model.CustomEmojiItem
import com.cove.chat.data.model.CustomEmojiResponse
import com.cove.chat.data.model.EmojiStyleInfo
import com.cove.chat.data.model.EmojiStylesResponse
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Parses a style's `index.json` into key -> packed cell position (`x shl 16 or y`). Pure, so it is unit tested. */
internal fun parseSpriteIndex(text: String): Pair<Int, Map<String, Int>> {
    val root = Json.parseToJsonElement(text).jsonObject
    val cell = root["size"]?.jsonPrimitive?.int ?: 64
    val emoji = root["emoji"] as? JsonObject ?: return cell to emptyMap()
    val out = HashMap<String, Int>(emoji.size * 2)
    for ((k, v) in emoji) {
        val a = v as? JsonArray ?: continue
        if (a.size < 2) continue
        out[k] = (a[0].jsonPrimitive.int shl 16) or a[1].jsonPrimitive.int
    }
    return cell to out
}

/**
 * One emoji style on disk: the sprite index in memory plus the WebP sheet decoded on demand. The full sheet is a
 * 60 MB bitmap, so it is only held while sprites are being cut from it and released a few seconds after the last
 * request; each emoji is a small copied cell kept in an LRU cache.
 */
class SpriteSheet(val id: String, private val cell: Int, private val index: Map<String, Int>, private val sheetFile: File) {
    private val cache = LruCache<String, ImageBitmap>(900)
    private val mutex = Mutex()
    @Volatile private var sheet: Bitmap? = null
    @Volatile private var releaseJob: Job? = null

    val count: Int get() = index.size
    fun has(key: String) = index.containsKey(key)
    fun cached(key: String): ImageBitmap? = cache.get(key)

    /** Cuts [key] out of the sheet; null when this style has no image for it or the sheet cannot be decoded. */
    suspend fun load(key: String, scope: CoroutineScope): ImageBitmap? {
        cache.get(key)?.let { return it }
        val packed = index[key] ?: return null
        return mutex.withLock {
            cache.get(key)?.let { return@withLock it }
            val s = sheet ?: runCatching { BitmapFactory.decodeFile(sheetFile.path) }.getOrNull()?.also { sheet = it } ?: return@withLock null
            val x = packed ushr 16
            val y = packed and 0xFFFF
            if (x + cell > s.width || y + cell > s.height) return@withLock null
            val bmp = Bitmap.createBitmap(s, x, y, cell, cell).asImageBitmap()
            cache.put(key, bmp)
            releaseJob?.cancel()
            releaseJob = scope.launch { delay(15_000); mutex.withLock { sheet?.recycle(); sheet = null } }
            bmp
        }
    }

    fun trim() { cache.evictAll() }
}

/**
 * Emoji rendering state for the whole app (docs/emoji-stickers-client.md): the active style's sprite sheet, the bundled
 * Noto sheet as the fallback, the animated-emoji table and the server's custom emoji. The default style (Noto) ships
 * in the APK so emoji never wait for the network; other styles are downloaded on demand from the server and cached
 * under `filesDir/emoji/<style>/<version>/`. An emoji with no sprite in either sheet is drawn with the system glyph,
 * so a cell is never blank.
 */
object EmojiEngine {
    const val NATIVE = "native"
    const val BUNDLED = "noto"
    private const val BUNDLED_VERSION = "bundled"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }
    private lateinit var appContext: Context
    private lateinit var prefs: PreferencesManager
    private var ready = false

    private val sheets = java.util.concurrent.ConcurrentHashMap<String, SpriteSheet>()
    private val requested = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val queue = Channel<Pair<SpriteSheet, String>>(Channel.UNLIMITED)
    private val pending = java.util.concurrent.atomic.AtomicInteger(0)

    /** Bumped whenever a batch of sprites was cut, so visible emoji swap their glyph for the image. */
    var version by mutableIntStateOf(0)
        private set
    /** Bumped whenever the active style, an index or a table changes: message text must be rebuilt. */
    var epoch by mutableIntStateOf(0)
        private set

    var stylesResponse by mutableStateOf<EmojiStylesResponse?>(null)
        private set
    /** Style ids being downloaded right now (Settings shows a spinner). */
    var downloading by mutableStateOf<Set<String>>(emptySet())
        private set
    var lastError by mutableStateOf<String?>(null)
        private set
    private var animated by mutableStateOf<Map<String, String>>(emptyMap())
    private var custom by mutableStateOf<Map<String, CustomEmojiItem>>(emptyMap())

    /** Emoji style ids the user may choose (always includes the device font), from the server or the cached list. */
    val enabledStyles: List<String>
        get() = (stylesResponse?.enabledStyles?.takeIf { it.isNotEmpty() } ?: listOf(NATIVE, BUNDLED)).let { if (NATIVE in it) it else listOf(NATIVE) + it }

    // The device font is never the default, even if a server lists it as default: users see Noto unless they pick "Device emoji".
    private val serverDefault: String get() = stylesResponse?.defaultStyle?.takeIf { it.isNotBlank() && it != NATIVE } ?: BUNDLED

    /** The style in use: the user's pick when the server still offers it, else the server's default. */
    val activeStyleId: String
        get() {
            val chosen = prefs.emojiStyle
            return if (chosen.isNotBlank() && chosen in enabledStyles) chosen else serverDefault
        }

    val customNames: Set<String> get() = custom.keys
    fun customItem(name: String): CustomEmojiItem? = custom[name]
    fun customItems(): List<CustomEmojiItem> = custom.values.toList()

    /** Server-relative URL of the animation for an emoji key, or null (no entry, or animations unavailable). */
    fun animatedUrl(key: String): String? = animated[key]
    val hasAnimatedTable: Boolean get() = animated.isNotEmpty()

    /** Opens the cache, loads the bundled Noto sheet and any table saved by an earlier run. Call once at startup. */
    fun init(context: Context, preferences: PreferencesManager) {
        if (ready) return
        appContext = context.applicationContext
        prefs = preferences
        ready = true
        scope.launch {
            runCatching { loadBundled() }
            readSaved<EmojiStylesResponse>("styles.json")?.let { stylesResponse = it }
            readSaved<AnimatedEmojiResponse>("animated.json")?.let { r -> animated = r.items.associate { it.sequence to it.url } }
            readSaved<CustomEmojiResponse>("custom.json")?.let { r -> custom = r.items.associateBy { it.name } }
            loadDownloaded()
            epoch++
        }
        scope.launch { for ((sheet, key) in queue) processRequest(sheet, key) }
    }

    private fun emojiDir() = File(appContext.filesDir, "emoji").apply { mkdirs() }

    private inline fun <reified T> readSaved(name: String): T? =
        runCatching { json.decodeFromString<T>(File(emojiDir(), name).readText()) }.getOrNull()

    private inline fun <reified T> save(name: String, value: T) {
        runCatching { File(emojiDir(), name).writeText(json.encodeToString(value)) }
    }

    /** Copies the bundled Noto sheet out of the APK once (BitmapFactory wants a file) and loads its index. */
    private fun loadBundled() {
        val dir = File(emojiDir(), "$BUNDLED/$BUNDLED_VERSION").apply { mkdirs() }
        val sheetFile = File(dir, "sheet.webp")
        val am = appContext.assets
        if (!sheetFile.exists() || sheetFile.length() == 0L) {
            val tmp = File(dir, "sheet.tmp")
            am.open("emoji/noto/sheet.webp").use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
            tmp.renameTo(sheetFile)
        }
        val (cell, index) = parseSpriteIndex(am.open("emoji/noto/index.json").bufferedReader().use { it.readText() })
        sheets[BUNDLED] = SpriteSheet(BUNDLED, cell, index, sheetFile)
        epoch++
    }

    /** Re-opens styles downloaded earlier (their version folder is named in the saved style list). */
    private fun loadDownloaded() {
        for (info in stylesResponse?.styles.orEmpty()) if (info.id != BUNDLED) openDownloaded(info)
    }

    private fun styleDir(info: EmojiStyleInfo) = File(emojiDir(), "${info.id}/${info.version}")

    private fun openDownloaded(info: EmojiStyleInfo): Boolean {
        val dir = styleDir(info)
        val sheetFile = File(dir, "sheet.webp")
        val indexFile = File(dir, "index.json")
        if (!sheetFile.isFile || !indexFile.isFile) return false
        val parsed = runCatching { parseSpriteIndex(indexFile.readText()) }.getOrNull() ?: return false
        sheets[info.id] = SpriteSheet(info.id, parsed.first, parsed.second, sheetFile)
        return true
    }

    /** True once [id]'s sheet is on this device (always for the device font and the bundled style). */
    fun isAvailable(id: String): Boolean = id == NATIVE || sheets.containsKey(id)

    /**
     * Fetches the style list, the animated table and the custom emoji, and downloads the active style when it is not
     * on the device yet. Safe to call often (a few small requests); failures leave what is cached in place.
     */
    suspend fun refresh() {
        if (!ready) return
        val api = CoveApp.instance.apiClient
        api.getEmojiStyles().onSuccess { r ->
            stylesResponse = r
            save("styles.json", r)
            epoch++
        }
        ensureActiveStyle()
        api.getAnimatedEmoji().onSuccess { r ->
            animated = r.items.associate { it.sequence to it.url }
            save("animated.json", r)
            epoch++
        }
        api.getCustomEmoji().onSuccess { r ->
            custom = r.items.associateBy { it.name }
            save("custom.json", r)
            epoch++
        }
    }

    /** Downloads the style the user (or the server default) selected, if needed. */
    suspend fun ensureActiveStyle() {
        val id = activeStyleId
        if (id == NATIVE || id == BUNDLED || sheets.containsKey(id)) return
        val info = stylesResponse?.styles?.firstOrNull { it.id == id } ?: return
        download(info)
    }

    /** Picks [id] as this device's emoji style and downloads it when needed. */
    suspend fun select(id: String) {
        prefs.emojiStyle = id
        epoch++
        ensureActiveStyle()
        epoch++
    }

    /** Downloads one style (sheet and index) into the cache. Returns whether it is ready afterwards. */
    suspend fun download(info: EmojiStyleInfo): Boolean {
        if (sheets.containsKey(info.id) && openedVersion(info)) return true
        if (info.id in downloading) return false
        downloading = downloading + info.id
        lastError = null
        try {
            val api = CoveApp.instance.apiClient
            val dir = styleDir(info).apply { mkdirs() }
            val index = api.getBytes(info.indexUrl).getOrElse { lastError = it.message; return false }
            val sheet = api.getBytes(info.sheetUrl).getOrElse { lastError = it.message; return false }
            // Write the sheet to a temp name and rename: a half-written file must never look like a finished one.
            val tmp = File(dir, "sheet.tmp")
            tmp.writeBytes(sheet)
            File(dir, "index.json").writeBytes(index)
            tmp.renameTo(File(dir, "sheet.webp"))
            val ok = openDownloaded(info)
            if (ok) {
                // Older versions of the same style are dead weight now.
                File(emojiDir(), info.id).listFiles()?.filter { it.name != info.version }?.forEach { it.deleteRecursively() }
                epoch++
            }
            return ok
        } finally {
            downloading = downloading - info.id
        }
    }

    private fun openedVersion(info: EmojiStyleInfo) = File(styleDir(info), "sheet.webp").isFile

    /** Removes a downloaded style from the device (the bundled one stays). */
    fun remove(id: String) {
        if (id == BUNDLED || id == NATIVE) return
        sheets.remove(id)
        File(emojiDir(), id).deleteRecursively()
        epoch++
    }

    // ── Lookup ──────────────────────────────────────────────────────────────

    private fun sheetFor(key: String): SpriteSheet? {
        val id = activeStyleId
        if (id == NATIVE) return null
        sheets[id]?.takeIf { it.has(key) }?.let { return it }
        // The active style has a gap (or is still downloading): borrow the bundled Noto image, else the glyph is used.
        return sheets[BUNDLED]?.takeIf { it.has(key) }
    }

    /** Whether some sprite exists for [key]; when false the caller keeps the system glyph. */
    fun hasSprite(key: String): Boolean = sheetFor(key) != null

    /** The sprite if it is already cut; otherwise queues it and returns null (the caller shows the glyph meanwhile). */
    fun spriteOrRequest(key: String): ImageBitmap? {
        val sheet = sheetFor(key) ?: return null
        sheet.cached(key)?.let { return it }
        if (requested.add("${sheet.id}:$key")) { pending.incrementAndGet(); queue.trySend(sheet to key) }
        return null
    }

    private suspend fun processRequest(sheet: SpriteSheet, key: String) {
        sheet.load(key, scope)
        requested.remove("${sheet.id}:$key")
        // One recomposition per drained batch instead of one per emoji.
        if (pending.decrementAndGet() <= 0) version++
    }

    /** Drops cut sprites (low-memory callback); they are cut again on demand. */
    fun trimMemory() { sheets.values.forEach { it.trim() } }
}
