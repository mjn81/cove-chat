package com.cove.chat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing

/** Same sizes as the web `ModalShell`; [Media] is edge-to-edge black for photo / video viewers. */
enum class DialogSize(val maxWidth: Dp) { Sm(360.dp), Md(480.dp), Lg(640.dp), Media(Dp.Unspecified) }

/**
 * The one dialog scaffold: flat bordered panel with an optional title row (and close button), a body and an optional
 * footer row of actions. [container] / [border] / [titleColor] / [footerContainer] only exist for Whisper mode's own palette.
 *
 * @param alignTop anchors the panel near the top (search-style dialogs) instead of centring it.
 * @param footer actions laid out end-aligned on the card tone; pass [CoveButton]s.
 */
@Composable
fun CoveDialog(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    size: DialogSize = DialogSize.Md,
    alignTop: Boolean = false,
    showClose: Boolean = true,
    container: Color = Color.Unspecified,
    border: Color = Color.Unspecified,
    titleColor: Color = Color.Unspecified,
    footerContainer: Color = Color.Unspecified,
    footer: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val c = CoveTheme.extendedColors
    val props = DialogProperties(usePlatformDefaultWidth = false)
    if (size == DialogSize.Media) {
        Dialog(onDismissRequest = onDismiss, properties = props) {
            Box(modifier.fillMaxSize().background(c.mediaBackground)) {
                Column(Modifier.fillMaxSize(), content = content)
                if (showClose) {
                    CoveIconButton(
                        Icons.Outlined.Close, "Close", onDismiss,
                        Modifier.align(Alignment.TopEnd).padding(Spacing.lg),
                        variant = IconButtonVariant.Scrim, size = 32.dp, iconSize = 16.dp
                    )
                }
            }
        }
        return
    }
    val bg = if (container != Color.Unspecified) container else c.chatCanvas
    val line = if (border != Color.Unspecified) border else c.border
    val panel: @Composable () -> Unit = {
        Column(
            modifier
                .padding(horizontal = Spacing.lg)
                .widthIn(max = size.maxWidth)
                .fillMaxWidth()
                .clip(CoveShapes.md)
                .background(bg)
                .border(1.dp, line, CoveShapes.md)
        ) {
            if (title != null) {
                Row(
                    Modifier.fillMaxWidth().padding(start = Spacing.lg, top = Spacing.xs, bottom = Spacing.xs, end = Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        title, style = CoveType.title,
                        color = if (titleColor != Color.Unspecified) titleColor else c.textPrimary,
                        modifier = Modifier.weight(1f).padding(vertical = Spacing.md)
                    )
                    if (showClose) CoveIconButton(Icons.Outlined.Close, "Close", onDismiss)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(line))
            }
            content()
            if (footer != null) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(line))
                Row(
                    Modifier.fillMaxWidth().background(if (footerContainer != Color.Unspecified) footerContainer else c.card).padding(Spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    content = footer
                )
            }
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = props) {
        if (alignTop) {
            Box(
                Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss),
                contentAlignment = Alignment.TopCenter
            ) {
                Box(Modifier.padding(top = 72.dp).clickable(enabled = false) {}) { panel() }
            }
        } else panel()
    }
}

/** Yes / no prompt; [destructive] paints the confirm button red (web `ConfirmModal`). */
@Composable
fun CoveConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    dismissLabel: String = "Cancel"
) {
    CoveDialog(
        onDismiss = onDismiss, title = title, size = DialogSize.Sm, showClose = false,
        footer = {
            CoveButton(dismissLabel, onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            CoveButton(
                confirmLabel, onConfirm, size = ButtonSize.Sm,
                variant = if (destructive) ButtonVariant.Destructive else ButtonVariant.Default
            )
        }
    ) {
        Text(message, style = CoveType.body, color = CoveTheme.extendedColors.textMuted, modifier = Modifier.padding(Spacing.lg))
    }
}
