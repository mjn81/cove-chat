package com.cove.chat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Flight
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SportsSoccer
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.PackItem
import com.cove.chat.emoji.CustomEmojiView
import com.cove.chat.emoji.EmojiEngine
import com.cove.chat.emoji.EmojiText
import com.cove.chat.emoji.EmojiView
import com.cove.chat.emoji.PickerCategory
import com.cove.chat.emoji.PickerData
import com.cove.chat.emoji.PickerEmoji
import com.cove.chat.emoji.ServerImage
import com.cove.chat.emoji.StickerLogic
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Parsed once per process; the 135 KB asset is read off the main thread the first time the panel opens. */
private object PickerCache {
    @Volatile var categories: List<PickerCategory>? = null
    suspend fun get(ctx: android.content.Context): List<PickerCategory> {
        categories?.let { return it }
        val parsed = withContext(Dispatchers.IO) {
            PickerData.parse(ctx.assets.open("emoji/picker.json").bufferedReader().use { it.readText() })
        }
        categories = parsed
        return parsed
    }
}

private val CategoryIcons: Map<String, ImageVector> = mapOf(
    "recent" to Icons.Outlined.Schedule, "custom" to Icons.Outlined.StickyNote2, "people" to Icons.Outlined.EmojiEmotions, "nature" to Icons.Outlined.Eco,
    "foods" to Icons.Outlined.Restaurant, "activity" to Icons.Outlined.SportsSoccer, "places" to Icons.Outlined.Flight,
    "objects" to Icons.Outlined.Lightbulb, "symbols" to Icons.Outlined.Category, "flags" to Icons.Outlined.Flag,
)

private val CategoryTitles = mapOf(
    "recent" to "Recently used", "custom" to "Custom emoji", "people" to "Smileys and people", "nature" to "Animals and nature",
    "foods" to "Food and drink", "activity" to "Activities", "places" to "Travel and places", "objects" to "Objects",
    "symbols" to "Symbols", "flags" to "Flags",
)

/**
 * Telegram-style emoji and sticker panel that takes the keyboard's place (rules: docs/emoji-stickers-client.md section 5).
 * Underlined Emoji | Stickers tabs, a pill search with the skin-tone button, small muted section titles, a dense grid
 * whose columns come from the measured width (`clamp(floor(w/40dp), 5, 12)`), and a bottom bar of category icons with a
 * rounded highlight on the section in view. The box has a fixed [height], so opening or closing it never moves the composer.
 * Tapping an emoji inserts it and the panel stays open. Stickers are offered only when [onSticker] is set.
 */
@Composable
fun EmojiStickerPanel(height: androidx.compose.ui.unit.Dp, onEmoji: (String) -> Unit, onSticker: ((String, PackItem) -> Unit)?, onDismiss: () -> Unit) {
    val c = CoveTheme.extendedColors
    val prefs = CoveApp.instance.preferencesManager
    var tab by remember { mutableStateOf(if (onSticker != null && prefs.panelTab == "stickers") "stickers" else "emoji") }
    Column(Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(12.dp)).background(c.popover).border(1.dp, c.border, RoundedCornerShape(12.dp))) {
        if (onSticker != null) {
            Row(Modifier.fillMaxWidth()) {
                listOf("emoji" to "Emoji", "stickers" to "Stickers").forEach { (id, label) ->
                    val on = tab == id
                    Column(Modifier.weight(1f).clickable { tab = id; prefs.panelTab = id }.padding(top = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(label, color = if (on) c.textPrimary else c.textMuted, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Spacer(Modifier.height(8.dp))
                        Box(Modifier.width(44.dp).height(2.dp).clip(CircleShape).background(if (on) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent))
                    }
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (tab == "stickers" && onSticker != null) StickerTab(onSticker) else EmojiTab(onEmoji)
        }
    }
}

@Composable
private fun EmojiTab(onEmoji: (String) -> Unit) {
    val c = CoveTheme.extendedColors
    val ctx = LocalContext.current
    val prefs = CoveApp.instance.preferencesManager
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    var categories by remember { mutableStateOf(PickerCache.categories) }
    LaunchedEffect(Unit) { if (categories == null) categories = PickerCache.get(ctx) }
    var recents by remember { mutableStateOf(prefs.recentEmojis.split(" ").filter { it.isNotBlank() }) }
    var tone by remember { mutableStateOf(prefs.emojiSkinTone) }
    var query by remember { mutableStateOf("") }
    var toneMenu by remember { mutableStateOf(false) }
    var widthDp by remember { mutableStateOf(0f) }
    val cols = EmojiText.pickerColumns(widthDp)
    // Custom emoji and the style change under the grid: re-read when the engine says so.
    val epoch = EmojiEngine.epoch
    val custom = remember(epoch) { EmojiEngine.customItems() }

    fun pick(s: String) {
        onEmoji(s)
        recents = PickerData.addRecent(recents, s)
        prefs.recentEmojis = recents.joinToString(" ")
    }

    val cats = categories
    Column(Modifier.fillMaxSize()) {
        // Search pill + skin tone.
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).height(36.dp).clip(CircleShape).background(c.card).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Search, null, tint = c.textMuted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text("Search emoji", color = c.textMuted, fontSize = 14.sp)
                    BasicTextField(
                        query, { query = it }, singleLine = true, textStyle = TextStyle(color = c.textPrimary, fontSize = 14.sp),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary), modifier = Modifier.fillMaxWidth()
                    )
                }
                if (query.isNotEmpty()) Icon(Icons.Outlined.Close, "Clear", tint = c.textMuted, modifier = Modifier.size(18.dp).clickable { query = "" })
            }
            Spacer(Modifier.width(6.dp))
            Box {
                Box(Modifier.size(36.dp).clip(CircleShape).clickable { toneMenu = true }, contentAlignment = Alignment.Center) {
                    EmojiView(PickerData.SKIN_SAMPLES[(tone - 1).coerceIn(0, 5)], 24.dp)
                }
                DropdownMenu(toneMenu, { toneMenu = false }) {
                    PickerData.SKIN_SAMPLES.forEachIndexed { i, s ->
                        DropdownMenuItem(text = { EmojiView(s, 26.dp) }, onClick = { tone = i + 1; prefs.emojiSkinTone = tone; toneMenu = false })
                    }
                }
            }
        }

        if (cats == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(22.dp), color = c.textMuted) }
            return@Column
        }

        val results = remember(query, cats) { if (query.isBlank()) null else PickerData.search(cats, query.trim()) }
        val grid = rememberLazyGridState()

        // Sections in display order; each remembers the grid index of its title so the bottom bar can jump there.
        class Section(val id: String, val emojis: List<PickerEmoji>?, val recent: List<String>?, val custom: Boolean)
        val sections = remember(cats, recents, custom) {
            buildList {
                if (recents.isNotEmpty()) add(Section("recent", null, recents, false))
                if (custom.isNotEmpty()) add(Section("custom", null, null, true))
                cats.forEach { add(Section(it.id, it.emojis, null, false)) }
            }
        }
        val starts = remember(sections) {
            var idx = 0
            sections.map { s -> idx.also { idx += 1 + (s.emojis?.size ?: s.recent?.size ?: custom.size) } }
        }
        val activeSection by remember(starts) { derivedStateOf { starts.indexOfLast { it <= grid.firstVisibleItemIndex }.coerceAtLeast(0) } }

        Box(Modifier.weight(1f).fillMaxWidth().onSizeChanged { widthDp = with(density) { it.width.toDp().value } }) {
            LazyVerticalGrid(GridCells.Fixed(cols), state = grid, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) {
                if (results != null) {
                    if (results.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("No emoji found", color = c.textMuted, fontSize = 13.sp, modifier = Modifier.padding(16.dp)) }
                    items(results, key = { "s" + it.native }) { e -> EmojiCell(e.forTone(tone)) { pick(e.forTone(tone)) } }
                } else sections.forEach { s ->
                    item(key = "h-" + s.id, span = { GridItemSpan(maxLineSpan) }) {
                        Text(CategoryTitles[s.id] ?: s.id, color = c.textMuted, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 6.dp, top = 8.dp, bottom = 4.dp))
                    }
                    when {
                        s.recent != null -> items(s.recent, key = { "r-$it" }) { r -> if (r.startsWith(":")) CustomCell(r) { pick(r) } else EmojiCell(r) { pick(r) } }
                        s.custom -> items(custom, key = { "c-" + it.name }) { it -> CustomCell(":${it.name}:") { pick(":${it.name}:") } }
                        else -> items(s.emojis.orEmpty(), key = { s.id + it.native }) { e -> EmojiCell(e.forTone(tone)) { pick(e.forTone(tone)) } }
                    }
                }
            }
        }
        // Bottom category bar: the section in view gets a rounded highlight.
        Row(Modifier.fillMaxWidth().border(width = 1.dp, color = c.border).padding(horizontal = 4.dp, vertical = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            sections.forEachIndexed { i, s ->
                val on = results == null && i == activeSection
                Box(
                    Modifier.weight(1f).height(38.dp).clip(RoundedCornerShape(10.dp)).background(if (on) c.accent else androidx.compose.ui.graphics.Color.Transparent)
                        .clickable { query = ""; scope.launch { grid.scrollToItem(starts[i]) } },
                    contentAlignment = Alignment.Center
                ) { Icon(CategoryIcons[s.id] ?: Icons.Outlined.Category, s.id, tint = if (on) c.textPrimary else c.textMuted, modifier = Modifier.size(20.dp)) }
            }
        }
    }
}

/** One emoji cell: 38 dp high, the emoji drawn at 26 dp. */
@Composable
private fun EmojiCell(emoji: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(38.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) { EmojiView(emoji, 26.dp) }
}

@Composable
private fun CustomCell(shortcode: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(38.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        CustomEmojiView(shortcode.trim(':'), 26.dp)
    }
}

@Composable
private fun StickerTab(onSticker: (String, PackItem) -> Unit) {
    val c = CoveTheme.extendedColors
    val prefs = CoveApp.instance.preferencesManager
    val userId = prefs.userId
    var list by remember { mutableStateOf<com.cove.chat.data.model.PackListResponse?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { CoveApp.instance.apiClient.getPacks().onSuccess { list = it }.onFailure { failed = true } }
    val response = list
    if (response == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (failed) Text("Stickers are not available on this server.", color = c.textMuted, fontSize = 13.sp, modifier = Modifier.padding(24.dp))
            else CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(22.dp), color = c.textMuted)
        }
        return
    }
    val packs = remember(response) { StickerLogic.orderedPacks(response.items, userId) }
    var recents by remember { mutableStateOf(prefs.recentStickers.split("\n").mapNotNull { StickerLogic.decodeRecent(it) }) }
    val known = remember(packs) { packs.map { it.id }.toSet() }
    val visibleRecents = remember(recents, known) { recents.filter { it.first in known } }
    var chosen by remember { mutableStateOf<String?>(null) }
    val tabs = remember(packs) { packs.map { it.id } }
    val active = chosen?.takeIf { it == "recent" || it in tabs }
        ?: StickerLogic.initialTab(tabs, prefs.stickerTab.ifBlank { null }, response.defaultPackId, visibleRecents.isNotEmpty())
    var pack by remember(active) { mutableStateOf(active?.takeIf { it != "recent" }?.let { PackCache.cached(it) }) }
    LaunchedEffect(active) { if (active != null && active != "recent" && pack == null) pack = PackCache.detail(active) }

    fun pick(packId: String, item: PackItem) {
        val lines = StickerLogic.addRecent(prefs.recentStickers.split("\n").filter { it.isNotBlank() }, packId, item, known)
        prefs.recentStickers = lines.joinToString("\n")
        recents = lines.mapNotNull { StickerLogic.decodeRecent(it) }
        onSticker(packId, item)
    }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                packs.isEmpty() -> Text("No sticker packs yet.", color = c.textMuted, fontSize = 13.sp, modifier = Modifier.padding(24.dp))
                active == "recent" -> StickerGrid(visibleRecents.map { it.second }, { item -> visibleRecents.firstOrNull { it.second.id == item.id }?.let { pick(it.first, it.second) } })
                pack == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(22.dp), color = c.textMuted) }
                else -> Column {
                    Text(pack!!.name, color = c.textMuted, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 2.dp))
                    StickerGrid(pack!!.items.orEmpty(), { pick(pack!!.id, it) })
                }
            }
        }
        Row(Modifier.fillMaxWidth().border(width = 1.dp, color = c.border).horizontalScroll(rememberScrollState()).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (visibleRecents.isNotEmpty()) TabCell(active == "recent", { chosen = "recent"; prefs.stickerTab = "recent" }) { Icon(Icons.Outlined.Schedule, "Recent", tint = c.textMuted, modifier = Modifier.size(20.dp)) }
            packs.forEach { p ->
                TabCell(active == p.id, { chosen = p.id; prefs.stickerTab = p.id }) {
                    if (p.coverUrl != null) ServerImage(p.coverUrl, p.name, Modifier.size(26.dp)) else Icon(Icons.Outlined.StickyNote2, p.name, tint = c.textMuted, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun TabCell(on: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(if (on) CoveTheme.extendedColors.accent else androidx.compose.ui.graphics.Color.Transparent).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { content() }
}
