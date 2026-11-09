package com.cove.chat.themes

import java.text.Normalizer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Outcome of [CoveThemeParser.parse]. */
sealed interface ThemeParseResult {
    data class Ok(val theme: ThemeDefinition, val assets: Map<String, ThemeAsset>, val warnings: List<ThemeIssue>) : ThemeParseResult
    data class Fail(val error: ThemeIssue, val errors: List<ThemeIssue>) : ThemeParseResult
}

/**
 * `.covetheme` format v1 parser and writer (port of `themes/utils/covetheme.ts`; format spec in `docs/covetheme-format.md`).
 * A theme file is data only: only `theme.json` and `assets/<name>.png|jpg|jpeg|webp` are ever read, unknown keys are dropped
 * with a warning, and the same size, ZIP, image and contrast limits apply as on the web client.
 */
object CoveThemeParser {
    const val MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
    const val MAX_ENTRIES = 20
    const val MAX_JSON_BYTES = 64 * 1024
    const val MAX_IMAGE_BYTES = 2 * 1024 * 1024
    const val MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024
    const val MAX_IMAGE_SIDE = 4096
    const val MAX_RATIO = 100
    const val MIME = "application/vnd.cove.theme+zip"
    const val EXTENSION = ".covetheme"

    private val ZIP_LIMITS = ZipLimits(
        maxArchiveBytes = MAX_ARCHIVE_BYTES, maxEntries = MAX_ENTRIES, maxEntryBytes = MAX_IMAGE_BYTES * 2,
        maxTotalBytes = MAX_ARCHIVE_BYTES.toLong() * 2, maxRatio = MAX_RATIO, ratioFloorBytes = MAX_JSON_BYTES,
    )
    private val ID_RE = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
    private val ASSET_NAME_RE = Regex("^assets/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.(png|jpe?g|webp)$")
    private val BAD_TEXT_RE = Regex("[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]")
    private val EXT_MIME = mapOf("png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp")
    private val TOP_LEVEL_KEYS = listOf("format", "version", "id", "name", "author", "license", "base", "tokens", "light", "chat", "preview")
    private val parser = Json { isLenient = false; ignoreUnknownKeys = true }

    private class Ctx(val assets: Map<String, ThemeAsset>) {
        val errors = mutableListOf<ThemeIssue>()
        val warnings = mutableListOf<ThemeIssue>()
    }

    private fun cleanText(value: JsonElement?, maxLength: Int): String? {
        val p = value as? JsonPrimitive ?: return null
        if (!p.isString) return null
        val text = Normalizer.normalize(p.content, Normalizer.Form.NFC).trim()
        if (text.isEmpty() || text.length > maxLength || BAD_TEXT_RE.containsMatchIn(text)) return null
        return text
    }

    private fun warnUnknown(obj: JsonObject, known: List<String>, scope: String, w: MutableList<ThemeIssue>) {
        for (key in obj.keys) if (key !in known) w += ThemeIssue("unknown_key", "$scope$key".take(60))
    }

    private fun str(v: JsonElement?): String? = (v as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun num(v: JsonElement?, fallback: Double, min: Double, max: Double): Double {
        val p = v as? JsonPrimitive ?: return fallback
        if (p.isString) return fallback
        val d = p.content.toDoubleOrNull() ?: return fallback
        return if (d.isFinite()) d.coerceIn(min, max) else fallback
    }

    /** JSON object to the loosely-typed map [ThemeTokens.sanitize] takes (strings stay strings, all else is opaque). */
    private fun toLooseMap(o: JsonObject): Map<String, Any?> =
        o.mapValues { (_, v) -> if (v is JsonPrimitive && v.isString) v.content else Any() }

    private fun parseName(v: JsonElement?, ctx: Ctx): LocalizedName? {
        val o = v as? JsonObject
        if (o == null) { ctx.errors += ThemeIssue("invalid_name"); return null }
        warnUnknown(o, listOf("en", "fa", "ar"), "name.", ctx.warnings)
        val en = cleanText(o["en"], 40)
        if (en == null) { ctx.errors += ThemeIssue("invalid_name", "en"); return null }
        var fa: String? = null
        var ar: String? = null
        for (lang in listOf("fa", "ar")) {
            if (o[lang] == null) continue
            val text = cleanText(o[lang], 40)
            if (text == null) ctx.warnings += ThemeIssue("invalid_name_dropped", lang)
            else if (lang == "fa") fa = text else ar = text
        }
        return LocalizedName(en, fa, ar)
    }

    private fun colorField(v: JsonElement?, field: String, ctx: Ctx): String? {
        val parsed = ThemeColor.parse(str(v))
        if (parsed == null) { ctx.errors += ThemeIssue("invalid_color", field); return null }
        if (parsed.clamped) ctx.warnings += ThemeIssue("token_clamped", field)
        return parsed.value
    }

    private fun parseBackground(v: JsonElement?, ctx: Ctx): ChatBackground? {
        val o = v as? JsonObject
        if (o == null) { ctx.errors += ThemeIssue("invalid_chat_background"); return null }
        val scope = "chat.background."
        return when (str(o["type"])) {
            "none" -> { warnUnknown(o, listOf("type"), scope, ctx.warnings); ChatBackground.None }
            "pattern" -> {
                warnUnknown(o, listOf("type", "pattern"), scope, ctx.warnings)
                val p = str(o["pattern"])
                if (p == null || p !in ChatPatternIds) { ctx.errors += ThemeIssue("invalid_chat_background", "pattern"); null } else ChatBackground.Pattern(p)
            }
            "color" -> {
                warnUnknown(o, listOf("type", "color"), scope, ctx.warnings)
                colorField(o["color"], "chat.background.color", ctx)?.let { ChatBackground.Color(it) }
            }
            "gradient" -> {
                warnUnknown(o, listOf("type", "from", "to", "angle"), scope, ctx.warnings)
                val from = colorField(o["from"], "chat.background.from", ctx)
                val to = colorField(o["to"], "chat.background.to", ctx)
                if (from == null || to == null) null
                else ChatBackground.Gradient(from, to, Math.round(num(o["angle"], 180.0, 0.0, 360.0)).toInt())
            }
            "image" -> {
                warnUnknown(o, listOf("type", "asset", "opacity", "blur", "fit"), scope, ctx.warnings)
                val asset = str(o["asset"])
                if (asset == null || asset !in ctx.assets) {
                    ctx.errors += ThemeIssue("missing_asset", asset?.take(80) ?: "asset"); null
                } else {
                    val fit = when (str(o["fit"])) { "contain" -> ImageFit.Contain; "tile" -> ImageFit.Tile; else -> ImageFit.Cover }
                    ChatBackground.Image(asset, num(o["opacity"], 1.0, 0.0, 1.0).toFloat(), num(o["blur"], 0.0, 0.0, 20.0).toFloat(), fit)
                }
            }
            else -> { ctx.errors += ThemeIssue("invalid_chat_background", "type"); null }
        }
    }

    private fun parseChat(v: JsonElement?, ctx: Ctx): ThemeChat? {
        val o = v as? JsonObject
        if (o == null) { ctx.errors += ThemeIssue("invalid_chat"); return null }
        warnUnknown(o, listOf("background", "bubble_tint"), "chat.", ctx.warnings)
        var background: ChatBackground? = null
        var tint: BubbleTint? = null
        if (o["background"] != null) background = parseBackground(o["background"], ctx)
        if (o["bubble_tint"] != null) {
            val t = o["bubble_tint"] as? JsonObject
            if (t != null) {
                warnUnknown(t, listOf("color", "strength"), "chat.bubble_tint.", ctx.warnings)
                val parsed = ThemeColor.parse(str(t["color"]))
                if (parsed != null) tint = BubbleTint(parsed.value, num(t["strength"], 0.1, 0.0, 1.0).toFloat())
                else ctx.warnings += ThemeIssue("bubble_tint_dropped")
            } else ctx.warnings += ThemeIssue("bubble_tint_dropped")
        }
        return if (background != null || tint != null) ThemeChat(background, tint) else null
    }

    private fun prefixed(list: List<ThemeIssue>, prefix: String) = list.map { it.copy(detail = prefix + (it.detail ?: "")) }

    /**
     * Validates a decoded `theme.json` against the schema. [assets] are the archive images that already passed the
     * image checks, keyed by archive path.
     */
    fun validateJson(json: JsonElement, assets: Map<String, ThemeAsset> = emptyMap()): ValidateResult {
        val ctx = Ctx(assets)
        val root = json as? JsonObject ?: return ValidateResult.Fail(listOf(ThemeIssue("invalid_json")), emptyList())
        if (str(root["format"]) != "cove-theme") return ValidateResult.Fail(listOf(ThemeIssue("not_a_theme")), emptyList())
        val vp = root["version"] as? JsonPrimitive
        val version = if (vp == null || vp.isString) null else vp.content.toDoubleOrNull()
        if (version == null || version != Math.floor(version) || version < 1) return ValidateResult.Fail(listOf(ThemeIssue("invalid_version")), emptyList())
        if (version > 1) return ValidateResult.Fail(listOf(ThemeIssue("unsupported_version", version.toLong().toString())), emptyList())
        warnUnknown(root, TOP_LEVEL_KEYS, "", ctx.warnings)

        val rawId = str(root["id"])
        val id = if (rawId != null && rawId.length in 3..64 && ID_RE.matches(rawId)) rawId else null
        if (id == null) ctx.errors += ThemeIssue("invalid_id")

        val name = parseName(root["name"], ctx)

        var author: String? = null
        if (root["author"] != null) { author = cleanText(root["author"], 60); if (author == null) ctx.warnings += ThemeIssue("author_dropped") }
        var license: String? = null
        if (root["license"] != null) { license = cleanText(root["license"], 40); if (license == null) ctx.warnings += ThemeIssue("license_dropped") }

        val base = ThemeMode.fromWire(str(root["base"]))
        if (base == null) ctx.errors += ThemeIssue("invalid_base")

        val main = ThemeTokens.sanitize((root["tokens"] as? JsonObject)?.let { toLooseMap(it) })
        ctx.errors += main.errors
        ctx.warnings += main.warnings
        if (main.errors.isEmpty()) {
            val (e, w) = ThemeTokens.checkReadability(main.tokens)
            ctx.errors += e; ctx.warnings += w
        }

        var light: Map<String, String>? = null
        if (root["light"] != null) {
            if (base == ThemeMode.Light) ctx.warnings += ThemeIssue("light_ignored")
            else {
                val l = ThemeTokens.sanitize((root["light"] as? JsonObject)?.let { toLooseMap(it) })
                ctx.errors += prefixed(l.errors, "light.")
                ctx.warnings += prefixed(l.warnings, "light.")
                if (l.errors.isEmpty()) {
                    val (e, w) = ThemeTokens.checkReadability(l.tokens)
                    ctx.errors += prefixed(e, "light."); ctx.warnings += prefixed(w, "light.")
                    light = l.tokens
                }
            }
        }

        val chat = if (root["chat"] != null) parseChat(root["chat"], ctx) else null

        // Text sits on top of a flat or gradient chat background: it must stay readable in every variant.
        val bg = chat?.background
        if (bg is ChatBackground.Color || bg is ChatBackground.Gradient) {
            val surfaces = if (bg is ChatBackground.Color) listOf(bg.color) else (bg as ChatBackground.Gradient).let { listOf(it.from, it.to) }
            val foregrounds = listOfNotNull(main.tokens["foreground"], light?.get("foreground"))
            if (surfaces.any { s -> foregrounds.any { f -> ThemeColor.contrast(f, s) < ThemeTokens.MIN_CONTRAST_HARD } }) {
                ctx.errors += ThemeIssue("low_contrast", "chat-background")
            }
        }

        var preview: String? = null
        if (root["preview"] != null) {
            val p = str(root["preview"])
            if (p != null && p in assets) preview = p else ctx.warnings += ThemeIssue("missing_preview")
        }

        if (ctx.errors.isNotEmpty() || id == null || name == null || base == null) return ValidateResult.Fail(ctx.errors, ctx.warnings)
        return ValidateResult.Ok(ThemeDefinition(id, name, base, main.tokens, light, author, license, chat, preview), ctx.warnings)
    }

    sealed interface ValidateResult {
        data class Ok(val theme: ThemeDefinition, val warnings: List<ThemeIssue>) : ValidateResult
        data class Fail(val errors: List<ThemeIssue>, val warnings: List<ThemeIssue>) : ValidateResult
    }

    private fun failWith(errors: List<ThemeIssue>) = ThemeParseResult.Fail(errors.first(), errors)

    /**
     * Parses and fully validates a `.covetheme` file; the only entry point for untrusted theme bytes. Never throws.
     * Decoding the images with the platform decoder is a separate step (`ThemeStore.verifyAssets`).
     */
    fun parse(bytes: ByteArray): ThemeParseResult = try { parseUnsafe(bytes) } catch (e: Exception) { failWith(listOf(ThemeIssue("zip_invalid"))) }

    private fun parseUnsafe(bytes: ByteArray): ThemeParseResult {
        val zip = ThemeZip.read(bytes, ZIP_LIMITS)
        if (zip is ZipResult.Fail) return failWith(listOf(zip.error))
        val entries = (zip as ZipResult.Ok).entries

        val warnings = mutableListOf<ThemeIssue>()
        val assets = LinkedHashMap<String, ThemeAsset>()
        var imageTotal = 0L
        for ((name, data) in entries) {
            if (name == "theme.json") continue
            if (!name.startsWith("assets/")) { warnings += ThemeIssue("ignored_entry", name.take(60)); continue }
            val m = ASSET_NAME_RE.find(name) ?: return failWith(listOf(ThemeIssue("invalid_asset_name", name)))
            if (data.size > MAX_IMAGE_BYTES) return failWith(listOf(ThemeIssue("image_too_large", name)))
            val sniffed = ImageSniff.sniff(data) ?: return failWith(listOf(ThemeIssue("invalid_image", name)))
            if (sniffed.mime != EXT_MIME[m.groupValues[1]]) return failWith(listOf(ThemeIssue("image_type_mismatch", name)))
            if (sniffed.width > MAX_IMAGE_SIDE || sniffed.height > MAX_IMAGE_SIDE) return failWith(listOf(ThemeIssue("image_dimensions", name)))
            imageTotal += data.size
            if (imageTotal > MAX_TOTAL_IMAGE_BYTES) return failWith(listOf(ThemeIssue("assets_too_large")))
            assets[name] = ThemeAsset(sniffed.mime, data, sniffed.width, sniffed.height)
        }

        val jsonBytes = entries["theme.json"] ?: return failWith(listOf(ThemeIssue("missing_theme_json")))
        if (jsonBytes.size > MAX_JSON_BYTES) return failWith(listOf(ThemeIssue("json_too_large")))
        val element = try {
            parser.parseToJsonElement(String(jsonBytes, Charsets.UTF_8).removePrefix("﻿"))
        } catch (e: Exception) { return failWith(listOf(ThemeIssue("invalid_json"))) }

        val result = validateJson(element, assets)
        if (result is ValidateResult.Fail) return failWith(result.errors)
        result as ValidateResult.Ok

        val used = HashSet<String>()
        (result.theme.chat?.background as? ChatBackground.Image)?.let { used += it.asset }
        result.theme.preview?.let { used += it }
        val kept = LinkedHashMap<String, ThemeAsset>()
        for ((path, asset) in assets) {
            if (path in used) kept[path] = asset else warnings += ThemeIssue("unused_asset", path)
        }
        return ThemeParseResult.Ok(result.theme, kept, warnings + result.warnings)
    }

    /** Converts a validated theme back into the `theme.json` object (snake_case, as on the wire). */
    fun toJson(theme: ThemeDefinition): JsonObject = buildJsonObject {
        put("format", "cove-theme")
        put("version", 1)
        put("id", theme.id)
        put("name", buildJsonObject { put("en", theme.name.en); theme.name.fa?.let { put("fa", it) }; theme.name.ar?.let { put("ar", it) } })
        theme.author?.let { put("author", it) }
        theme.license?.let { put("license", it) }
        put("base", theme.base.wire)
        put("tokens", buildJsonObject { theme.tokens.forEach { (k, v) -> put(k, v) } })
        theme.light?.let { l -> put("light", buildJsonObject { l.forEach { (k, v) -> put(k, v) } }) }
        val chat = theme.chat
        if (chat != null && (chat.background != null || chat.bubbleTint != null)) {
            put("chat", buildJsonObject {
                chat.background?.let { bg ->
                    put("background", buildJsonObject {
                        when (bg) {
                            ChatBackground.None -> put("type", "none")
                            is ChatBackground.Pattern -> { put("type", "pattern"); put("pattern", bg.pattern) }
                            is ChatBackground.Color -> { put("type", "color"); put("color", bg.color) }
                            is ChatBackground.Gradient -> { put("type", "gradient"); put("from", bg.from); put("to", bg.to); put("angle", bg.angle) }
                            is ChatBackground.Image -> {
                                put("type", "image"); put("asset", bg.asset); put("opacity", bg.opacity); put("blur", bg.blur)
                                put("fit", bg.fit.name.lowercase())
                            }
                        }
                    })
                }
                chat.bubbleTint?.let { t -> put("bubble_tint", buildJsonObject { put("color", t.color); put("strength", t.strength) }) }
            })
        }
        theme.preview?.let { put("preview", it) }
    }

    /** Writes a `.covetheme` archive (theme.json plus the referenced images, stored). */
    fun build(theme: ThemeDefinition, assets: Map<String, ThemeAsset> = emptyMap()): ByteArray {
        val files = LinkedHashMap<String, ByteArray>()
        files["theme.json"] = toJson(theme).toString().toByteArray(Charsets.UTF_8)
        for ((path, asset) in assets) files[path] = asset.bytes
        return ThemeZip.writeStored(files)
    }
}
