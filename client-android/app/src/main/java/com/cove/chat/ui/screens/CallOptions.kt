package com.cove.chat.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.cove.chat.CoveApp
import com.cove.chat.rtc.AudioRoute
import com.cove.chat.rtc.CameraQuality
import com.cove.chat.rtc.ReceiveQuality
import com.cove.chat.rtc.ScreenQuality
import com.cove.chat.ui.components.ButtonVariant
import com.cove.chat.ui.components.CoveButton
import com.cove.chat.ui.components.CoveChoiceList
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.CoveSegmented
import com.cove.chat.ui.components.CoveSwitchRow
import com.cove.chat.ui.components.IconButtonVariant
import com.cove.chat.ui.components.Segment
import com.cove.chat.ui.components.SectionHeader
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.Spacing
import org.webrtc.EglBase

/** Call options that do not fit the control bar: audio output, deafen, camera flip and the quality settings. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CallOptionsSheet(onDismiss: () -> Unit) {
    val c = CoveTheme.extendedColors
    val rtc = CoveApp.instance.webRTCManager
    val routes by rtc.audioRouter.routes.collectAsState()
    val route by rtc.audioRouter.current.collectAsState()
    val deafened by rtc.isDeafened.collectAsState()
    val videoOn by rtc.isVideoEnabled.collectAsState()
    val camQ by rtc.cameraQuality.collectAsState()
    val scrQ by rtc.screenQuality.collectAsState()
    val adaptive by rtc.adaptiveQuality.collectAsState()
    val receive by rtc.receiveQuality.collectAsState()

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.popover, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl)) {
            SectionHeader("Audio output")
            CoveChoiceList(routes.map { it.name to it.label }, route.name) { id -> rtc.audioRouter.select(AudioRoute.valueOf(id)) }
            Spacer(Modifier.height(Spacing.md))
            CoveSwitchRow("Deafen", deafened, caption = "Silence everyone else's audio") { rtc.toggleDeafen() }
            if (videoOn) {
                Spacer(Modifier.height(Spacing.sm))
                CoveButton("Switch camera", { rtc.switchCamera() }, Modifier.fillMaxWidth(), variant = ButtonVariant.Outline)
            }
            Spacer(Modifier.height(Spacing.md))
            SectionHeader("Camera quality")
            CoveSegmented(CameraQuality.entries.map { Segment(it.label) }, camQ.ordinal, { rtc.setCameraQuality(CameraQuality.entries[it]) })
            Spacer(Modifier.height(Spacing.md))
            SectionHeader("Screen share quality")
            CoveSegmented(ScreenQuality.entries.map { Segment(it.label) }, scrQ.ordinal, { rtc.setScreenQuality(ScreenQuality.entries[it]) })
            Spacer(Modifier.height(Spacing.sm))
            CoveSwitchRow("Adaptive quality", adaptive, caption = "Lower the video quality automatically on a poor network") { rtc.setAdaptiveQuality(it) }
            Spacer(Modifier.height(Spacing.md))
            SectionHeader("Shared screens (receiving)")
            CoveChoiceList(ReceiveQuality.entries.map { it.name to it.label }, receive.name) { rtc.setReceiveQuality(ReceiveQuality.valueOf(it)) }
        }
    }
}

/**
 * Full-screen view of a shared screen: pinch to zoom (1x-5x), drag to pan when zoomed, double-tap to toggle 1x/2.5x.
 * The zoom is applied to the renderer view itself because a SurfaceView ignores Compose graphics layers.
 */
@Composable
internal fun ScreenViewerDialog(tile: CallTile, egl: EglBase, receive: ReceiveQuality, onDismiss: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            tile.track?.let { track ->
                VideoRenderer(track, egl, mirror = false, fit = true, fpsReduction = receive.fpsReduction?.takeIf { receive != ReceiveQuality.Paused }, modifier = Modifier.fillMaxSize()) { view ->
                    view.scaleX = scale; view.scaleY = scale
                    view.translationX = offset.x; view.translationY = offset.y
                }
            }
            // Transparent gesture layer above the SurfaceView, which would otherwise swallow the touches.
            Box(
                Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            val maxX = size.width * (scale - 1f) / 2f
                            val maxY = size.height * (scale - 1f) / 2f
                            offset = if (scale <= 1f) Offset.Zero else Offset((offset.x + pan.x * scale).coerceIn(-maxX, maxX), (offset.y + pan.y * scale).coerceIn(-maxY, maxY))
                        }
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f })
                    }
            )
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                Text(tile.name, color = Color.White, modifier = Modifier.weight(1f).padding(start = Spacing.sm), maxLines = 1)
                CoveIconButton(Icons.Outlined.Close, "Close", onDismiss, variant = IconButtonVariant.Scrim, size = 48.dp, iconSize = 24.dp)
            }
        }
    }
}
