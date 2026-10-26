package com.nodetalk.client.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Radius
import com.nodetalk.client.ui.theme.Spacing

/**
 * The one list row (conversations, people, search results, menu entries, permission rows). Slots: [leading]
 * avatar / icon, [title] + optional [subtitle], [trailing] actions or badge. [compact] is the denser search-result look.
 * Pass [onClick] to make it tappable; [selected] fills it with the accent tone (settings menu).
 */
@Composable
fun CoveListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    selected: Boolean = false,
    compact: Boolean = false,
    titleColor: Color = Color.Unspecified,
    titleIcon: ImageVector? = null,
    titleIconTint: Color = Color.Unspecified,
    contentPadding: PaddingValues = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.sm),
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null
) {
    val c = CoveTheme.extendedColors
    val shape = CoveShapes.md
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) c.accent else Color.Transparent)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(contentPadding),
        verticalAlignment = Alignment.CenterVertically
    ) {
        leading?.let { it(); Spacer(Modifier.width(Spacing.md)) }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                titleIcon?.let {
                    Icon(it, null, tint = titleIconTint, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    title,
                    color = if (titleColor != Color.Unspecified) titleColor else c.textPrimary,
                    style = if (compact) CoveType.label else CoveType.body,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis
                )
            }
            if (!subtitle.isNullOrBlank()) {
                Text(
                    subtitle, color = c.textMuted,
                    style = if (compact) CoveType.caption else CoveType.label,
                    fontWeight = FontWeight.Normal,
                    maxLines = 1, overflow = TextOverflow.Ellipsis
                )
            }
        }
        trailing?.let { Spacer(Modifier.width(Spacing.sm)); it() }
    }
}

/** Unread / count pill on the primary colour. */
@Composable
fun CoveBadge(count: Int, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier.heightIn(min = 18.dp).widthIn(min = 18.dp).clip(CoveShapes.lg).background(scheme.primary).padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center
    ) { Text(count.toString(), color = scheme.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
}

/** Title + caption on the left, switch on the right (web `SettingRow` + `ui/switch`). */
@Composable
fun CoveSwitchRow(
    title: String,
    checked: Boolean,
    modifier: Modifier = Modifier,
    caption: String? = null,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit
) {
    val c = CoveTheme.extendedColors
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = c.textPrimary, style = CoveType.body, fontWeight = FontWeight.Medium)
            if (caption != null) Text(caption, color = c.textMuted, style = CoveType.label, fontWeight = FontWeight.Normal)
        }
        Switch(
            checked = checked, onCheckedChange = onChange, enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedTrackColor = MaterialTheme.colorScheme.primary, checkedThumbColor = Color.White,
                uncheckedTrackColor = c.accent, uncheckedThumbColor = Color.White,
                uncheckedBorderColor = Color.Transparent, checkedBorderColor = Color.Transparent
            )
        )
    }
}

/** Filter chip with optional icon and count (web `Badge` / tab pill). */
@Composable
fun CoveChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, count: Int? = null) {
    val c = CoveTheme.extendedColors
    val scheme = MaterialTheme.colorScheme
    val tint = if (selected) scheme.onPrimary else c.textMuted
    Row(
        modifier.clip(CoveShapes.md).background(if (selected) scheme.primary else Color.Transparent).clickable(onClick = onClick).padding(horizontal = Spacing.md, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        icon?.let { Icon(it, null, tint = tint, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp)) }
        Text(label, color = tint, style = CoveType.caption, fontWeight = FontWeight.Medium, maxLines = 1)
        count?.let { Spacer(Modifier.width(6.dp)); Text(it.toString(), color = tint.copy(alpha = 0.75f), fontSize = 10.sp) }
    }
}

/** One option of [CoveSegmented]. */
data class Segment(val label: String, val icon: ImageVector? = null)

/** Equal-width segmented control on a bordered card strip (web `SegmentedControl`). */
@Composable
fun CoveSegmented(segments: List<Segment>, selectedIndex: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = CoveTheme.extendedColors
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier
            .fillMaxWidth()
            .clip(CoveShapes.md)
            .border(1.dp, c.border, CoveShapes.md)
            .background(c.card)
            .padding(3.dp)
    ) {
        segments.forEachIndexed { i, seg ->
            val on = i == selectedIndex
            val tint = if (on) scheme.onPrimary else c.textMuted
            Row(
                Modifier
                    .weight(1f)
                    .heightIn(min = 36.dp)
                    .clip(RoundedCornerShape(Radius.sm + 2.dp))
                    .background(if (on) scheme.primary else Color.Transparent)
                    .clickable { onSelect(i) },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                seg.icon?.let { Icon(it, null, tint = tint, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
                Text(seg.label, color = tint, style = CoveType.label, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Centred icon tile, title, message and optional action row for "nothing here" states. */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    icon: ImageVector = Icons.Outlined.Search,
    actions: (@Composable RowScope.() -> Unit)? = null
) {
    val c = CoveTheme.extendedColors
    Column(modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = Spacing.lg), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(48.dp).clip(CoveShapes.lg).background(c.accent.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.textMuted, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.size(Spacing.md))
        Text(title, color = c.textPrimary, style = CoveType.label, fontWeight = FontWeight.SemiBold)
        if (message != null) {
            Spacer(Modifier.size(Spacing.xs))
            Text(message, color = c.textMuted, style = CoveType.caption, textAlign = TextAlign.Center)
        }
        if (actions != null) {
            Spacer(Modifier.size(Spacing.lg))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), content = actions)
        }
    }
}

/** Small uppercase group title with an optional spinner (search groups, settings sections). */
@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier, loading: Boolean = false) {
    Row(modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text.uppercase(), color = CoveTheme.extendedColors.textMuted, fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp, modifier = Modifier.weight(1f)
        )
        if (loading) CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 1.5.dp, modifier = Modifier.size(12.dp))
    }
}

/** Vertical list of radio-style options; the selected one is outlined and tinted in the primary colour. */
@Composable
fun CoveChoiceList(options: List<Pair<String, String>>, selected: String, modifier: Modifier = Modifier, enabled: Boolean = true, onSelect: (String) -> Unit) {
    val c = CoveTheme.extendedColors
    val primary = MaterialTheme.colorScheme.primary
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        options.forEach { (id, label) ->
            val on = id == selected
            CoveListRow(
                title = label,
                titleColor = if (on) c.textPrimary else c.textMuted,
                onClick = if (enabled) ({ onSelect(id) }) else null,
                contentPadding = PaddingValues(Spacing.md),
                modifier = Modifier.border(1.dp, if (on) primary else c.border, CoveShapes.md).background(if (on) primary.copy(alpha = 0.12f) else Color.Transparent, CoveShapes.md)
            )
        }
    }
}
