package com.cove.chat.emoji

import com.cove.chat.data.model.Pack
import com.cove.chat.data.model.PackItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** Decrypted body of a `sticker` message: `{pack_id, sticker_id, file_id}` (docs/packs-api.md). */
data class StickerBody(val packId: String, val stickerId: String, val fileId: String)

/** Pure sticker helpers shared by the panel, the bubble and the share card (ports of the web `stickers/utils`). */
object StickerLogic {
    private const val MAX_ID = 128
    private const val SHARE_PREFIX = "cove://stickers/"
    private val PACK_ID = Regex("^[A-Za-z0-9_-]{1,128}$")

    /** The text that gets encrypted into a sticker message. Built-in stickers send an empty `file_id`. */
    fun encode(packId: String, item: PackItem): String = buildJsonObject {
        put("pack_id", packId); put("sticker_id", item.id); put("file_id", item.fileId.orEmpty())
    }.toString()

    /** Reads a decrypted sticker body; null when it is not a valid one (the bubble then shows a notice). */
    fun parse(text: String?): StickerBody? {
        if (text.isNullOrBlank()) return null
        val o = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return null
        fun str(k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val pack = str("pack_id")?.takeIf { it.isNotEmpty() && it.length <= MAX_ID } ?: return null
        val sticker = str("sticker_id")?.takeIf { it.isNotEmpty() && it.length <= MAX_ID } ?: return null
        if (o["file_id"] != null && str("file_id") == null) return null
        return StickerBody(pack, sticker, str("file_id").orEmpty())
    }

    /** Stored stickers are channel-less files; built-in ones (no file id, or an id equal to the sticker id) return null. */
    fun filePath(b: StickerBody): String? =
        if (b.fileId.isNotEmpty() && b.fileId != b.stickerId) "/api/files/${java.net.URLEncoder.encode(b.fileId, "UTF-8")}" else null

    /** Share card token: a `text` message whose whole body is `cove://stickers/<pack id>`. */
    fun encodeShare(packId: String) = "$SHARE_PREFIX$packId"

    /** The pack id when the entire message (ignoring whitespace) is a share token, else null. */
    fun parseShare(text: String?): String? {
        val t = text?.trim() ?: return null
        if (!t.startsWith(SHARE_PREFIX)) return null
        val id = t.removePrefix(SHARE_PREFIX)
        return if (PACK_ID.matches(id)) id else null
    }

    /** Panel tab order: server packs (built-in included, default first), then my packs, then added ones. */
    fun orderedPacks(packs: List<Pack>, userId: String?): List<Pack> {
        val server = packs.filter { it.scope != "user" }
        val mine = packs.filter { it.scope == "user" && it.ownerId == userId }
        val added = packs.filter { it.scope == "user" && it.ownerId != userId }
        return server + mine + added
    }

    /** Which tab to open: the remembered one if it still exists, else the default pack, else the first pack. */
    fun initialTab(tabs: List<String>, remembered: String?, defaultPackId: String?, hasRecents: Boolean): String? {
        if (remembered == "recent" && hasRecents) return "recent"
        if (remembered != null && remembered in tabs) return remembered
        if (hasRecents) return "recent"
        if (defaultPackId != null && defaultPackId in tabs) return defaultPackId
        return tabs.firstOrNull()
    }

    /** A recent sticker as one line: `packId|stickerId|fileId|animated|url|emoji` (no `|` can occur in those fields). */
    fun encodeRecent(packId: String, i: PackItem) = listOf(packId, i.id, i.fileId.orEmpty(), if (i.animated) "1" else "0", i.url, i.emoji.orEmpty()).joinToString("|")

    fun decodeRecent(line: String): Pair<String, PackItem>? {
        val p = line.split('|')
        if (p.size < 6 || p[0].isEmpty() || p[1].isEmpty()) return null
        return p[0] to PackItem(id = p[1], fileId = p[2].ifEmpty { null }, animated = p[3] == "1", url = p[4], emoji = p[5].ifEmpty { null })
    }

    /** Adds to the recents list (newest first, no duplicates, at most [max]) and drops entries of packs that are gone. */
    fun addRecent(lines: List<String>, packId: String, item: PackItem, knownPacks: Set<String>? = null, max: Int = 24): List<String> {
        val line = encodeRecent(packId, item)
        val key = "$packId|${item.id}|"
        return (listOf(line) + lines.filter { !it.startsWith(key) })
            .filter { l -> knownPacks == null || l.substringBefore('|') in knownPacks }
            .take(max)
    }

    /** One-line chat preview, e.g. "🙂 Sticker". */
    fun previewLabel(label: String, emoji: String?) = if (emoji.isNullOrEmpty()) label else "$emoji $label"
}
