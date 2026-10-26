package com.nodetalk.client.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.nodetalk.client.ui.theme.CoveShapes
import com.nodetalk.client.ui.theme.CoveTheme
import com.nodetalk.client.ui.theme.CoveType
import com.nodetalk.client.ui.theme.Radius
import com.nodetalk.client.ui.theme.Sizes
import com.nodetalk.client.ui.theme.Spacing

/** Same names as the web `ui/button` variants. */
enum class ButtonVariant { Default, Secondary, Outline, Ghost, Destructive }

/** Heights: sm 32, md 40, lg 44 (full-width form submit buttons). */
enum class ButtonSize(val height: Dp) { Sm(32.dp), Md(40.dp), Lg(Sizes.button) }

/**
 * The one text button. [containerColor] / [contentColor] override the variant only where a screen has its own palette
 * (the pitch-black Whisper mode); everything else should pick a [variant].
 */
@Composable
fun CoveButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Default,
    size: ButtonSize = ButtonSize.Md,
    loading: Boolean = false,
    enabled: Boolean = true,
    containerColor: Color = Color.Unspecified,
    contentColor: Color = Color.Unspecified
) {
    val c = CoveTheme.extendedColors
    val scheme = MaterialTheme.colorScheme
    var container = when (variant) {
        ButtonVariant.Default -> scheme.primary
        ButtonVariant.Secondary -> c.accent
        ButtonVariant.Outline, ButtonVariant.Ghost -> Color.Transparent
        ButtonVariant.Destructive -> scheme.error
    }
    var content = when (variant) {
        ButtonVariant.Default -> scheme.onPrimary
        ButtonVariant.Destructive -> Color.White
        else -> c.textPrimary
    }
    if (containerColor != Color.Unspecified) container = containerColor
    if (contentColor != Color.Unspecified) content = contentColor
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.height(size.height),
        shape = CoveShapes.md,
        border = if (variant == ButtonVariant.Outline) BorderStroke(1.dp, c.border) else null,
        contentPadding = PaddingValues(horizontal = if (size == ButtonSize.Sm) Spacing.md else Spacing.lg),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = container.copy(alpha = container.alpha * 0.5f),
            disabledContentColor = content.copy(alpha = 0.5f)
        )
    ) {
        if (loading) {
            CircularProgressIndicator(color = content, strokeWidth = 2.dp, modifier = Modifier.size(Sizes.icon))
        } else {
            Text(text, style = if (size == ButtonSize.Sm) CoveType.label else CoveType.body, fontWeight = FontWeight.Medium)
        }
    }
}

/** Icon button looks: [Ghost] muted glyph, [Filled] card tile (call controls), [Scrim] translucent circle over media. */
enum class IconButtonVariant { Ghost, Destructive, Filled, Scrim }

/**
 * The one icon-only button (replaces the per-screen toolbar / round / control / call buttons). [selected] with a
 * [selectedColor] paints toggles such as mute; [size] is the tap target, [iconSize] the glyph.
 */
@Composable
fun CoveIconButton(
    icon: ImageVector,
    desc: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: IconButtonVariant = IconButtonVariant.Ghost,
    size: Dp = 36.dp,
    iconSize: Dp = Sizes.icon,
    selected: Boolean = false,
    enabled: Boolean = true,
    tint: Color = Color.Unspecified,
    selectedColor: Color = Color.Unspecified,
    mirrorInRtl: Boolean = false
) {
    val c = CoveTheme.extendedColors
    val scheme = MaterialTheme.colorScheme
    val shape = if (variant == IconButtonVariant.Scrim || variant == IconButtonVariant.Destructive) CircleShape else RoundedCornerShape(Radius.md)
    val paintedSelected = selected && selectedColor != Color.Unspecified
    val bg = when {
        paintedSelected -> selectedColor
        variant == IconButtonVariant.Destructive -> scheme.error
        variant == IconButtonVariant.Filled -> c.card
        variant == IconButtonVariant.Scrim -> c.overlay
        else -> Color.Transparent
    }
    val glyph = when {
        tint != Color.Unspecified -> tint
        paintedSelected || variant == IconButtonVariant.Destructive || variant == IconButtonVariant.Scrim -> Color.White
        variant == IconButtonVariant.Filled -> c.textPrimary
        else -> c.textMuted
    }
    Box(
        modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.5f)
            .clip(shape)
            .background(bg)
            .let { if (variant == IconButtonVariant.Filled) it.border(1.dp, c.border, shape) else it }
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Icon(icon, desc, tint = glyph, modifier = Modifier.size(iconSize).let { if (mirrorInRtl) it.mirrorInRtl() else it }) }
}
