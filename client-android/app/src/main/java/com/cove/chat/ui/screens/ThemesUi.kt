package com.cove.chat.ui.screens

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.cove.chat.CoveApp
import com.cove.chat.data.model.FileMeta
import com.cove.chat.themes.BuiltinThemes
import com.cove.chat.themes.ChatBackground
import com.cove.chat.themes.CoveThemeParser
import com.cove.chat.themes.InstallResult
import com.cove.chat.themes.InstalledTheme
import com.cove.chat.themes.ThemeAsset
import com.cove.chat.themes.ThemeColor
import com.cove.chat.themes.ThemeDefinition
import com.cove.chat.themes.ThemeIssue
import com.cove.chat.themes.ThemeIssueText
import com.cove.chat.themes.ThemeMode
import com.cove.chat.themes.ThemeParseResult
import com.cove.chat.themes.ThemeState
import com.cove.chat.ui.components.AppLanguage
import com.cove.chat.ui.components.ButtonSize
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.ChatBackgroundIds
import com.cove.chat.ui.components.ChatBackgroundSettings
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveDialog
import com.cove.chat.ui.components.CoveSegmented
import com.cove.chat.ui.components.DialogSize
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.Segment
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.chatBackgroundPattern
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Colour from a canonical token triplet of [def]'s resolved palette. */
private fun tok(tokens: Map<String, String>, name: String) = Color(ThemeColor.tripletToArgb(tokens.getValue(name)))

/** The theme's own name in the app language. */
fun ThemeDefinition.localName(): String = name.forLanguage(AppLanguage.code)

/** What an import attempt produced, ready for the confirmation dialog or an error toast. */
sealed interface ThemeImport {
    class Ready(val theme: ThemeDefinition, val assets: Map<String, ThemeAsset>, val bytes: ByteArray, val warnings: List<ThemeIssue>) : ThemeImport
    class Failed(val error: ThemeIssue) : ThemeImport
}

/** Validates theme bytes (never throws). */
fun inspectThemeBytes(bytes: ByteArray): ThemeImport = when (val r = CoveThemeParser.parse(bytes)) {
    is ThemeParseResult.Ok -> ThemeImport.Ready(r.theme, r.assets, bytes, r.warnings)
    is ThemeParseResult.Fail -> ThemeImport.Failed(r.error)
}

/** Text for a refusal, in the app language. */
fun themeIssueMessage(issue: ThemeIssue): String = ThemeIssueText.message(issue, AppLanguage.code)

/** Reads at most the format's size limit from [uri]; null when it is bigger (the parser would refuse it anyway). */
private suspend fun readLimited(context: android.content.Context, uri: Uri): ByteArray? = withContext(Dispatchers.IO) {
    runCatching {
        context.contentResolver.openInputStream(uri)?.use { s ->
            val limit = CoveThemeParser.MAX_ARCHIVE_BYTES + 1
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            while (out.size() < limit) { val n = s.read(buf, 0, minOf(buf.size, limit - out.size())); if (n < 0) break; out.write(buf, 0, n) }
            out.toByteArray()
        }
    }.getOrNull()
}

/** Writes [bytes] to the shared-attachment cache and opens the system share sheet for it. */
private fun shareThemeFile(context: android.content.Context, fileName: String, bytes: ByteArray) {
    val dir = File(context.cacheDir, "attachments").apply { mkdirs() }
    val file = File(dir, fileName.replace(Regex("[^A-Za-z0-9._-]"), "_"))
    file.writeBytes(bytes)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).setType(CoveThemeParser.MIME).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { context.startActivity(Intent.createChooser(send, fileName)) }
        .onFailure { I18nToast.make(context, "No app can open this file.", Toast.LENGTH_SHORT).show() }
}

/** A mini mock of [def] in [mode]: canvas, side panel, two text lines and the accent dot. */
@Composable
fun ThemeSwatch(def: ThemeDefinition, mode: ThemeMode, modifier: Modifier = Modifier) {
    val t = BuiltinThemes.resolve(def, mode).tokens
    Box(modifier.clip(CoveShapes.md).background(tok(t, "background")).border(1.dp, tok(t, "border"), CoveShapes.md)) {
        Box(Modifier.align(Alignment.CenterStart).width(22.dp).fillMaxHeight().background(tok(t, "card")))
        Column(Modifier.align(Alignment.CenterStart).padding(start = 30.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.width(46.dp).height(5.dp).clip(CoveShapes.sm).background(tok(t, "foreground")))
            Box(Modifier.width(30.dp).height(5.dp).clip(CoveShapes.sm).background(tok(t, "muted-foreground")))
        }
        Box(Modifier.align(Alignment.BottomEnd).padding(6.dp).size(14.dp).clip(CircleShape).background(tok(t, "primary")))
    }
}

@Composable
private fun ThemeTile(def: ThemeDefinition, selected: Boolean, mode: ThemeMode, onClick: () -> Unit) {
    val c = CoveTheme.extendedColors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        Modifier.width(104.dp).clip(CoveShapes.lg).border(2.dp, if (selected) primary else c.border, CoveShapes.lg)
            .clickable(onClick = onClick).padding(Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        ThemeSwatch(def, mode, Modifier.fillMaxWidth().height(48.dp))
        Spacer(Modifier.height(Spacing.xs))
        Text(def.localName(), color = if (selected) c.textPrimary else c.textMuted, style = CoveType.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Settings > Appearance > Theme: mode switch, built-in and installed themes, import, export and share. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ThemesSection() {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<ThemeImport.Ready?>(null) }
    var checking by remember { mutableStateOf(false) }
    var shareTarget by remember { mutableStateOf<Pair<String, ByteArray>?>(null) }
    var toDelete by remember { mutableStateOf<InstalledTheme?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        checking = true
        scope.launch {
            val bytes = readLimited(context, uri)
            val result = if (bytes == null) ThemeImport.Failed(ThemeIssue("zip_invalid")) else withContext(Dispatchers.Default) { inspectThemeBytes(bytes) }
            checking = false
            when (result) {
                is ThemeImport.Ready -> pending = result
                is ThemeImport.Failed -> I18nToast.make(context, themeIssueMessage(result.error), Toast.LENGTH_LONG).show()
            }
        }
    }

    val mode = ThemeState.mode
    Text("MODE", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(Spacing.md))
    CoveSegmented(
        listOf(Segment("Dark"), Segment("Light")), if (mode == ThemeMode.Dark) 0 else 1,
        { ThemeState.chooseMode(if (it == 0) ThemeMode.Dark else ThemeMode.Light) }
    )
    if (ThemeState.active.base == ThemeMode.Dark && ThemeState.active.light == null || ThemeState.active.base == ThemeMode.Light && mode == ThemeMode.Dark) {
        Spacer(Modifier.height(Spacing.xs))
        Text(
            if (ThemeState.active.base == ThemeMode.Dark) "This theme only has a dark look." else "This theme only has a light look.",
            color = c.textMuted, fontSize = CoveType.caption.fontSize
        )
    }

    Spacer(Modifier.height(Spacing.xl))
    Text("THEME", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(Spacing.md))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BuiltinThemes.ALL.forEach { def -> ThemeTile(def, ThemeState.active.id == def.id, mode) { ThemeState.select(def) } }
        ThemeState.installed.forEach { t ->
            ThemeTile(t.definition, ThemeState.active.id == t.definition.id, mode) { ThemeState.select(t.definition, t.assets) }
        }
    }

    Spacer(Modifier.height(Spacing.xl))
    Text("INSTALLED ON THIS DEVICE", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(Spacing.sm))
    if (ThemeState.installed.isEmpty()) {
        Text("Themes you import appear here.", color = c.textMuted, fontSize = CoveType.label.fontSize)
    } else {
        ThemeState.installed.forEach { t ->
            Row(Modifier.fillMaxWidth().padding(vertical = Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(t.definition.localName(), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    t.definition.author?.let { Text("by $it", color = c.textMuted, fontSize = CoveType.caption.fontSize) }
                }
                SmallIcon(Icons.Outlined.Send, "Share to chat") { ThemeState.exportBytes(t.definition)?.let { shareTarget = it } }
                SmallIcon(Icons.Outlined.FileDownload, "Export current theme") { ThemeState.exportBytes(t.definition)?.let { (n, b) -> shareThemeFile(context, n, b) } }
                SmallIcon(Icons.Outlined.Delete, "Delete", tint = MaterialTheme.colorScheme.error) { toDelete = t }
            }
        }
    }

    Spacer(Modifier.height(Spacing.lg))
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
        CoveButton("Import .covetheme file", { picker.launch(arrayOf("*/*")) }, Modifier.weight(1f), ButtonVariant.Secondary, loading = checking)
    }
    Spacer(Modifier.height(Spacing.sm))
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
        CoveButton("Export current theme", {
            ThemeState.exportBytes(ThemeState.active)?.let { (n, b) -> shareThemeFile(context, n, b) }
        }, Modifier.weight(1f), ButtonVariant.Outline, ButtonSize.Lg)
        CoveButton("Share to chat", { ThemeState.exportBytes(ThemeState.active)?.let { shareTarget = it } }, Modifier.weight(1f), ButtonVariant.Outline, ButtonSize.Lg)
    }
    Spacer(Modifier.height(Spacing.xs))
    Text("Theme files only change colours and backgrounds. They never contain code.", color = c.textMuted, fontSize = CoveType.caption.fontSize)

    pending?.let { p ->
        ThemeOfferDialog(p, onDismiss = { pending = null }, onDone = { pending = null })
    }
    shareTarget?.let { (name, bytes) ->
        ForwardDialog("", onDismiss = { shareTarget = null }, onPick = { target ->
            shareTarget = null
            scope.launch {
                val ok = runCatching { sendPrepared(target, bytes, CoveThemeParser.MIME, name, "file", asDocument = true) }.isSuccess
                I18nToast.make(context, if (ok) "Theme file sent." else "Couldn't send the theme file.", Toast.LENGTH_SHORT).show()
            }
        })
    }
    toDelete?.let { t ->
        com.cove.chat.ui.components.CoveConfirmDialog(
            title = "Delete theme", message = "Delete ${t.definition.localName()} from this device?", confirmLabel = "Delete", destructive = true,
            onConfirm = { ThemeState.delete(t.definition.id); toDelete = null }, onDismiss = { toDelete = null }
        )
    }

    Spacer(Modifier.height(Spacing.xxl))
    ChatBackgroundSection()
}

@Composable
private fun SmallIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color = Color.Unspecified, onClick: () -> Unit) {
    val c = CoveTheme.extendedColors
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = if (tint == Color.Unspecified) c.textMuted else tint, modifier = Modifier.size(20.dp))
    }
}

/** Chat background picker: the patterns, plus the active theme's own background when it carries one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatBackgroundSection() {
    val c = CoveTheme.extendedColors
    val themeBg = ThemeState.active.chat?.background
    val ids = (if (themeBg != null && themeBg !is ChatBackground.None) listOf("theme") else emptyList()) + ChatBackgroundIds
    Text("CHAT BACKGROUND", color = c.textMuted, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(12.dp))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ids.forEach { id ->
            val on = ChatBackgroundSettings.id == id
            Column(
                Modifier.width(88.dp).clip(CoveShapes.lg).border(2.dp, if (on) MaterialTheme.colorScheme.primary else c.border, CoveShapes.lg)
                    .clickable { ThemeState.setChatBackground(id) }.padding(Spacing.sm),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(Modifier.fillMaxWidth().height(64.dp).clip(CoveShapes.md).background(c.chatCanvas).chatBackgroundPattern(id, alpha = 0.12f))
                Spacer(Modifier.height(Spacing.xs))
                Text(if (id == "theme") "Theme" else id.replaceFirstChar { it.uppercase() }, color = if (on) c.textPrimary else c.textMuted, style = CoveType.label, maxLines = 1)
            }
        }
    }
}

/**
 * The confirmation shown for a theme file that passed validation (picked from storage or received in a chat): name,
 * author, licence, notes and the three choices. Preview paints it for [ThemeState.PREVIEW_MS]; Install keeps it.
 */
@Composable
fun ThemeOfferDialog(offer: ThemeImport.Ready, onDismiss: () -> Unit, onDone: () -> Unit) {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    CoveDialog(
        onDismiss = onDismiss, title = offer.theme.localName(), size = DialogSize.Sm,
        footer = {
            CoveButton("Preview", { ThemeState.startPreview(offer.theme, offer.assets, install = true); onDone() }, variant = ButtonVariant.Secondary)
            Spacer(Modifier.width(Spacing.sm))
            CoveButton("Install", { installTheme(context, offer.bytes, select = true); onDone() })
        }
    ) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ThemeSwatch(offer.theme, ThemeState.mode, Modifier.fillMaxWidth().height(64.dp))
            Text(offer.theme.author?.let { "by $it" } ?: "Unknown author", color = c.textMuted, style = CoveType.label)
            offer.theme.license?.let { Text("License: $it", color = c.textMuted, style = CoveType.caption) }
            if (offer.warnings.isNotEmpty()) {
                Text("Notes", color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.Bold)
                offer.warnings.take(6).forEach { Text("• ${themeIssueMessage(it)}", color = c.textMuted, style = CoveType.caption) }
            }
        }
    }
}

/** Installs [bytes] and optionally selects the theme; reports success or the refusal as a toast. */
fun installTheme(context: android.content.Context, bytes: ByteArray, select: Boolean): Boolean {
    return when (val r = ThemeState.install(bytes)) {
        is InstallResult.Installed -> {
            if (select) ThemeState.select(r.theme.definition, r.theme.assets)
            I18nToast.make(context, "Installed ${r.theme.definition.localName()}", Toast.LENGTH_SHORT).show()
            true
        }
        is InstallResult.Refused -> { I18nToast.make(context, themeIssueMessage(r.error), Toast.LENGTH_LONG).show(); false }
    }
}

/**
 * Floating "Previewing X: Apply / Revert" bar. It sits above everything (mounted in the root), counts down and
 * reverts by itself after [ThemeState.PREVIEW_MS]; only Apply persists. A preview never survives a restart.
 */
@Composable
fun ThemePreviewBar(modifier: Modifier = Modifier) {
    val preview = ThemeState.preview ?: return
    val context = LocalContext.current
    var now by remember(preview) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(preview) {
        while (true) {
            now = System.currentTimeMillis()
            if (now >= preview.expiresAt) { ThemeState.expirePreview(now); break }
            delay(500)
        }
    }
    val seconds = ((preview.expiresAt - now) / 1000).coerceAtLeast(0)
    // A fixed Cove-dark palette (web `preview-bar-palette.ts`): the bar must stay readable on whatever is being previewed.
    val dark = BuiltinThemes.COVE_DARK
    val bg = tok(dark, "popover")
    val fg = tok(dark, "foreground")
    Row(
        modifier.navigationBarsPadding().padding(12.dp).widthIn(max = 560.dp).fillMaxWidth().clip(CoveShapes.lg).background(bg).border(1.dp, tok(dark, "border"), CoveShapes.lg).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.Palette, null, tint = tok(dark, "primary"), modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text("Previewing ${preview.theme.localName()}", color = fg, style = CoveType.label, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Reverts in ${seconds}s", color = tok(dark, "muted-foreground"), style = CoveType.caption)
        }
        CoveButton("Revert", { ThemeState.endPreview() }, variant = ButtonVariant.Ghost, size = ButtonSize.Lg, contentColor = fg)
        Spacer(Modifier.width(4.dp))
        CoveButton("Apply", {
            val ok = if (preview.install) {
                val bytes = CoveThemeParser.build(preview.theme, preview.assets)
                installTheme(context, bytes, select = true)
            } else { ThemeState.select(preview.theme, preview.assets); true }
            if (ok) ThemeState.endPreview()
        }, size = ButtonSize.Lg)
    }
}

/**
 * A `.covetheme` file message: a card with the theme's name, author, a colour strip and Preview / Install buttons.
 * The file is downloaded, decrypted and validated like any import; nothing is applied until the user chooses.
 */
@Composable
fun ThemeFileCard(channelId: String, meta: FileMeta, keyVersion: Int) {
    val c = CoveTheme.extendedColors
    val context = LocalContext.current
    var state by remember(meta.fileId) { mutableStateOf<ThemeImport?>(null) }
    var loading by remember(meta.fileId) { mutableStateOf(true) }
    LaunchedEffect(meta.fileId, keyVersion) {
        loading = true
        val bytes = loadAttachment(channelId, meta)
        state = if (bytes == null) ThemeImport.Failed(ThemeIssue("download_failed")) else withContext(Dispatchers.Default) { inspectThemeBytes(bytes) }
        loading = false
    }
    val s = state
    Column(
        Modifier.padding(top = 4.dp).fillMaxWidth(0.9f).clip(CoveShapes.md).border(1.dp, c.border, CoveShapes.md).background(c.card).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        when {
            loading -> Text("Checking ${meta.name}…", color = c.textMuted, style = CoveType.label)
            s is ThemeImport.Ready -> {
                val installed = ThemeState.installed.any { it.definition.id == s.theme.id }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Palette, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(s.theme.localName(), color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(s.theme.author?.let { "by $it" } ?: "Unknown author", color = c.textMuted, style = CoveType.caption)
                    }
                }
                ThemeSwatch(s.theme, ThemeState.mode, Modifier.fillMaxWidth().height(48.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CoveButton("Preview", { ThemeState.startPreview(s.theme, s.assets, install = !installed) }, Modifier.weight(1f), ButtonVariant.Secondary, ButtonSize.Lg)
                    if (installed) {
                        CoveButton("Installed", {}, Modifier.weight(1f), ButtonVariant.Outline, ButtonSize.Lg, enabled = false)
                    } else {
                        CoveButton("Install", { installTheme(context, s.bytes, select = false) }, Modifier.weight(1f), size = ButtonSize.Lg)
                    }
                }
            }
            s is ThemeImport.Failed -> {
                Text("${meta.name} is not a usable theme", color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.Bold)
                Text(themeIssueMessage(s.error), color = c.textMuted, style = CoveType.caption)
                Text("Nothing was applied.", color = c.textMuted, style = CoveType.caption)
            }
        }
    }
}

/** True for a `.covetheme` file message (by extension or MIME), the same test the web client uses. */
fun isThemeFile(meta: FileMeta): Boolean =
    meta.name.lowercase().endsWith(CoveThemeParser.EXTENSION) || meta.mime.lowercase() == CoveThemeParser.MIME
