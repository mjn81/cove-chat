package com.cove.chat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.Spacing

/** One big labelled action in the attachment sheet. */
/** [tint] gives the action its own solid colour (Telegram-style tile); null uses the sheet's single accent. */
class AttachAction(val icon: ImageVector, val label: String, val tint: Color? = null, val run: () -> Unit)

/**
 * Bottom sheet with a grid of large labelled attachment actions (min 88dp cells, 56dp round icons), shared by the
 * chat composer and the Whisper composer so both are equally easy to use one-handed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentSheet(actions: List<AttachAction>, container: Color, accent: Color, labelColor: Color, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = container, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(88.dp), userScrollEnabled = false,
            contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.sm),
            modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = Spacing.lg)
        ) {
            items(actions) { a ->
                Column(
                    Modifier.clip(CoveShapes.lg).clickable { onDismiss(); a.run() }.padding(Spacing.sm).heightIn(min = 88.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
                ) {
                    Box(Modifier.size(56.dp).clip(CircleShape).background(a.tint ?: accent.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
                        Icon(a.icon, null, tint = if (a.tint != null) Color.White else accent, modifier = Modifier.size(28.dp))
                    }
                    Spacer(Modifier.height(Spacing.xs))
                    Text(a.label, color = labelColor, fontSize = 14.sp, textAlign = TextAlign.Center, maxLines = 2)
                }
            }
        }
    }
}
