package com.cove.chat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.cove.chat.CoveApp
import com.cove.chat.data.model.Pack
import com.cove.chat.data.model.PackItem
import com.cove.chat.emoji.AnimatedServerImage
import com.cove.chat.emoji.EmojiText
import com.cove.chat.emoji.ServerImage
import com.cove.chat.emoji.StickerBody
import com.cove.chat.emoji.StickerLogic
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.DialogSize
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import kotlinx.coroutines.launch

/** In-memory pack details (`GET /api/packs/{id}`), shared by the panel, bubbles and cards so each pack is fetched once. */
object PackCache {
    private val details = java.util.concurrent.ConcurrentHashMap<String, Pack>()
    fun cached(id: String): Pack? = details[id]
    suspend fun detail(id: String, force: Boolean = false): Pack? {
        if (!force) details[id]?.let { return it }
        return CoveApp.instance.apiClient.getPack(id).getOrNull()?.also { details[id] = it }
    }
    fun forget(id: String) { details.remove(id) }
}

/** A sticker image: animated WebP loops (when [animate]), everything else is a static image. */
@Composable
fun StickerImage(item: PackItem, modifier: Modifier = Modifier, animate: Boolean = false) {
    if (item.animated && animate) AnimatedServerImage(item.url, item.emoji, modifier)
    else ServerImage(item.url, item.emoji, modifier)
}

/** Grid of one pack's stickers (the sticker tab body and the pack dialog). Columns follow the width: 3 to 6. */
@Composable
fun StickerGrid(items: List<PackItem>, onPick: (PackItem) -> Unit, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    var widthDp by remember { mutableStateOf(0f) }
    val cols = EmojiText.stickerColumns(widthDp)
    LazyVerticalGrid(
        GridCells.Fixed(cols), modifier.onSizeChanged { widthDp = with(density) { it.width.toDp().value } }.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp, vertical = 4.dp)
    ) {
        items(items, key = { it.id }) { item ->
            Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(CoveShapes.lg).clickable { onPick(item) }.padding(6.dp), contentAlignment = Alignment.Center) {
                StickerImage(item, Modifier.fillMaxWidth())
            }
        }
    }
}

/** What a `sticker` message shows: the image at 168 dp, no bubble. Built-in images come from the pack detail's versioned URL. */
@Composable
fun StickerBubble(body: StickerBody, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    val item by produceState<PackItem?>(null, body) {
        val stored = StickerLogic.filePath(body)
        value = if (stored != null) PackItem(id = body.stickerId, fileId = body.fileId, url = stored, animated = true)
        else PackCache.detail(body.packId)?.items?.firstOrNull { it.id == body.stickerId }
    }
    Box(modifier.size(168.dp), contentAlignment = Alignment.Center) {
        val it = item
        if (it == null) CircularProgressIndicator(color = c.textMuted, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        else {
            // A stored sticker's animated flag is unknown from the body: the animated view falls back to a still frame by itself.
            AnimatedServerImage(it.url, it.emoji, Modifier.size(168.dp))
        }
    }
}

/** The "Add stickers" share card for a `cove://stickers/<id>` text message. */
@Composable
fun PackShareCard(packId: String, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    val scope = rememberCoroutineScope()
    var pack by remember(packId) { mutableStateOf<Pack?>(null) }
    var failed by remember(packId) { mutableStateOf(false) }
    var open by remember { mutableStateOf(false) }
    LaunchedEffect(packId) { pack = PackCache.detail(packId, force = true); failed = pack == null }
    Row(
        modifier.padding(top = 4.dp).fillMaxWidth(0.9f).clip(CoveShapes.md).border(1.dp, c.border, CoveShapes.md).background(c.card)
            .clickable(enabled = pack != null) { open = true }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.StickyNote2, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            val p = pack
            Text(p?.name ?: if (failed) "This sticker pack isn't available." else "Loading…", color = c.textPrimary, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (p != null) Text("${p.itemCount} stickers", color = c.textMuted, style = CoveType.caption)
        }
        if (pack != null) CoveButton(if (pack?.installed == true) "View" else "Add stickers", { open = true }, size = ButtonSize.Sm, variant = ButtonVariant.Secondary)
    }
    if (open) pack?.let { p ->
        PackDetailDialog(p, onDismiss = { open = false }, onChanged = { scope.launch { pack = PackCache.detail(packId, force = true) } })
    }
}

/** Pack preview with Add / Remove (installing puts the pack in the sticker panel). */
@Composable
fun PackDetailDialog(pack: Pack, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    CoveDialog(
        onDismiss = onDismiss, title = pack.name, size = DialogSize.Md,
        footer = {
            // Built-in and server packs are always in the picker; your own pack is deleted, not removed.
            if (pack.scope == "user" && !pack.editable) {
                CoveButton(
                    if (pack.installed) "Remove" else "Add stickers",
                    {
                        busy = true
                        scope.launch {
                            val api = CoveApp.instance.apiClient
                            if (pack.installed) api.uninstallPack(pack.id) else api.installPack(pack.id)
                            busy = false; onChanged(); onDismiss()
                        }
                    },
                    loading = busy, variant = if (pack.installed) ButtonVariant.Secondary else ButtonVariant.Default
                )
            }
        }
    ) {
        Column(Modifier.height(360.dp)) {
            pack.ownerName?.let { Text("by $it", color = CoveTheme.extendedColors.textMuted, style = CoveType.caption, modifier = Modifier.padding(horizontal = 16.dp)) }
            StickerGrid(pack.items.orEmpty(), onPick = {}, Modifier.weight(1f))
        }
    }
}
