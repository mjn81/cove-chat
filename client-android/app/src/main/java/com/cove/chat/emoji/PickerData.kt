package com.cove.chat.emoji

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** One picker entry: the emoji plus what search matches on and its skin-tone variants (tones 2 to 6). */
class PickerEmoji(val native: String, val name: String, val keywords: String, val skins: List<String>) {
    /** The character for skin tone [tone] (1 = default); emoji without tone variants keep their only form. */
    fun forTone(tone: Int): String = if (tone <= 1) native else skins.getOrNull(tone - 2) ?: native
}

/** A named group of emoji in display order (`people`, `nature`, `foods`, `activity`, `places`, `objects`, `symbols`, `flags`). */
class PickerCategory(val id: String, val emojis: List<PickerEmoji>)

/**
 * The picker's emoji list (names, keywords, categories, skin tones), generated into `assets/emoji/picker.json` by
 * `tools/gen_emoji_picker.mjs` from the same `@emoji-mart/data` the web picker uses. Pure, so it is unit tested.
 */
object PickerData {
    /** Parses the asset text. Malformed entries are skipped. */
    fun parse(text: String): List<PickerCategory> {
        val root = Json.parseToJsonElement(text).jsonObject
        return (root["categories"] as? JsonArray).orEmpty().mapNotNull { c ->
            val o = c as? JsonObject ?: return@mapNotNull null
            val id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val emojis = (o["emojis"] as? JsonArray).orEmpty().mapNotNull { e ->
                val a = e as? JsonArray ?: return@mapNotNull null
                if (a.size < 3) return@mapNotNull null
                PickerEmoji(
                    a[0].jsonPrimitive.content, a[1].jsonPrimitive.content, a[2].jsonPrimitive.content,
                    (a.getOrNull(3) as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty(),
                )
            }
            PickerCategory(id, emojis)
        }
    }

    /**
     * Emoji whose name or keywords match every word of [query]; name-prefix matches rank first (same scoring as the web
     * picker's `searchEmoji`).
     */
    fun search(categories: List<PickerCategory>, query: String, limit: Int = 90): List<PickerEmoji> {
        val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val ranked = ArrayList<Pair<PickerEmoji, Int>>()
        for (cat in categories) for (e in cat.emojis) {
            val name = e.name.lowercase()
            val kw = e.keywords.lowercase()
            var score = 0
            var all = true
            for (w in words) {
                when {
                    name.startsWith(w) -> score += 3
                    name.contains(w) -> score += 2
                    kw.contains(w) -> score += 1
                    else -> { all = false; break }
                }
            }
            if (all) ranked += e to score
        }
        return ranked.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    /** Recents keep only single emoji and `:name:` shortcodes, newest first, without duplicates, at most [max]. */
    fun addRecent(recents: List<String>, picked: String, max: Int = 32): List<String> {
        if (picked.isBlank()) return recents
        val isShortcode = picked.startsWith(":") && picked.endsWith(":")
        val tokens = EmojiText.tokenize(picked)
        val single = tokens.size == 1 && tokens[0] is EmojiToken.Emoji
        if (!single && !isShortcode) return recents
        return (listOf(picked) + recents.filter { it != picked }).take(max)
    }

    /** Skin-tone sample characters for the tone button and its menu. */
    val SKIN_SAMPLES = listOf("👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿")
}
