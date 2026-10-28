package com.cove.chat.ui.screens

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.ScreenShare
import androidx.compose.material.icons.outlined.StopScreenShare
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.cove.chat.CoveApp
import com.cove.chat.rtc.ReceiveQuality
import com.cove.chat.service.CallService
import com.cove.chat.ui.components.CoveIconButton
import com.cove.chat.ui.components.I18nToast
import com.cove.chat.ui.components.IconButtonVariant
import com.cove.chat.ui.components.Text
import com.cove.chat.ui.components.UserAvatar
import com.cove.chat.ui.theme.CoveShapes
import com.cove.chat.ui.theme.CoveTheme
import com.cove.chat.ui.theme.CoveType
import com.cove.chat.ui.theme.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/** One thing on the call stage: a person's camera/avatar, or somebody's shared screen. */
internal class CallTile(
    val key: String,
    val userId: String,
    val name: String,
    val isSelf: Boolean,
    val track: VideoTrack?,
    val isScreen: Boolean,
    val audioOn: Boolean
)

/**
 * Group call (WebRTC SFU). Shared screens get their own large tiles and are spotlighted automatically; tap any tile
 * to spotlight it (tap again for the grid). The layout adapts to portrait (strip below the spotlight, 1-2 grid
 * columns) and landscape (strip beside it, 2-3 columns). Secondary options live in the "More" sheet.
 */
@Composable
fun CallScreen(
    channelId: String,
    channelName: String,
    withVideo: Boolean,
    onCallEnded: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = CoveTheme.extendedColors
    val rtc = CoveApp.instance.webRTCManager
    fun toast(msg: String) = I18nToast.make(context, msg, android.widget.Toast.LENGTH_SHORT).show()

    val inCall by rtc.isInCall.collectAsState()
    val muted by rtc.isMuted.collectAsState()
    val videoOn by rtc.isVideoEnabled.collectAsState()
    val sharing by rtc.isScreenSharing.collectAsState()
    val participants by rtc.participants.collectAsState()
    val remoteVideo by rtc.remoteVideo.collectAsState()
    val remoteScreens by rtc.remoteScreens.collectAsState()
    val localVideo by rtc.localVideo.collectAsState()
    val selfId by rtc.selfId.collectAsState()
    val status by rtc.status.collectAsState()
    val speaking by rtc.speaking.collectAsState()
    val networkPoor by rtc.networkPoor.collectAsState()
    val receive by rtc.receiveQuality.collectAsState()
    val frontCamera by rtc.isFrontCamera.collectAsState()

    var started by remember { mutableStateOf(false) }
    var showMore by remember { mutableStateOf(false) }
    var spotlight by remember { mutableStateOf<String?>(null) }
    var viewer by remember { mutableStateOf<CallTile?>(null) }
    var elapsed by remember { mutableLongStateOf(0L) }

    LaunchedEffect(channelId) {
        rtc.joinCall(channelId, withVideo)
        CallService.start(context, channelName)
    }
    // The notification's Leave button (or a fatal error) ends the call outside this screen.
    // Only a call that was seen running can end; the flow may still report the initial `false` right after joinCall().
    LaunchedEffect(inCall) { if (inCall) started = true else if (started) onCallEnded() }
    LaunchedEffect(inCall) { while (inCall) { elapsed = (android.os.SystemClock.elapsedRealtime() - rtc.callStartedAt) / 1000; delay(1000) } }
    // Leaving the screen (back gesture included) always ends the call and the foreground service.
    DisposableEffect(Unit) {
        onDispose {
            rtc.leaveCall()
            CallService.stop(context)
        }
    }

    val projection = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val data = res.data
        if (res.resultCode != Activity.RESULT_OK || data == null) return@rememberLauncherForActivityResult
        scope.launch {
            // Android 14+ only allows MediaProjection while a mediaProjection-typed foreground service is running.
            CallService.start(context, channelName, screenShare = true)
            withTimeoutOrNull(3_000) { CallService.screenReady.first { it } }
            if (!rtc.startScreenShare(data)) { toast("Couldn't start screen sharing."); CallService.start(context, channelName) }
        }
    }
    fun toggleShare() {
        if (sharing) { rtc.stopScreenShare(); CallService.start(context, channelName) }
        else projection.launch((context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).createScreenCaptureIntent())
    }

    val tiles = remember(participants, remoteVideo, remoteScreens, localVideo, videoOn, sharing, selfId) {
        buildList {
            participants.forEach { p ->
                val self = p.userId == selfId
                val track = if (self) localVideo.takeIf { videoOn } else remoteVideo[p.userId]?.takeIf { p.video }
                add(CallTile(p.userId, p.userId, p.username, self, track, false, p.audio))
            }
            participants.forEach { p ->
                val track = if (p.userId == selfId) null else remoteScreens[p.userId]
                if (track != null) add(CallTile(p.userId + ":screen", p.userId, p.username, false, track, true, true))
            }
        }
    }
    // A fresh screen share is spotlighted until the user picks something else.
    val auto = tiles.firstOrNull { it.isScreen }?.key
    val focus = (spotlight ?: auto)?.takeIf { k -> tiles.any { it.key == k } }

    Column(Modifier.fillMaxSize().background(c.chatCanvas).navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().background(c.card).statusBarsPadding().padding(horizontal = Spacing.lg, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(channelName, color = c.textPrimary, fontSize = CoveType.title.fontSize, fontWeight = FontWeight.Bold, maxLines = 1)
                val line = if (status.isNotBlank() && status != "Connected") status else "%d:%02d  ·  %d in call".format(elapsed / 60, elapsed % 60, participants.size)
                Text(line, color = if (status == "Connected" || status.isBlank()) c.textMuted else c.warning, fontSize = CoveType.label.fontSize, maxLines = 1)
            }
            if (networkPoor) {
                Icon(Icons.Outlined.Warning, "Poor network, video quality reduced", tint = c.warning, modifier = Modifier.size(22.dp))
            }
        }

        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val landscape = maxWidth > maxHeight
            val tileClick: (CallTile) -> Unit = { t -> spotlight = if (focus == t.key) "" else t.key }
            val focusTile = tiles.firstOrNull { it.key == focus }
            if (focusTile != null && spotlight != "") {
                val rest = tiles.filter { it.key != focusTile.key }
                if (landscape) {
                    Row(Modifier.fillMaxSize().padding(Spacing.sm), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        CallTileView(focusTile, speaking, receive, rtc.eglBase, frontCamera, Modifier.weight(1f).fillMaxHeight(), { tileClick(focusTile) }, { viewer = focusTile })
                        if (rest.isNotEmpty()) LazyColumn(Modifier.width(150.dp).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            items(rest, key = { it.key }) { t -> CallTileView(t, speaking, receive, rtc.eglBase, frontCamera, Modifier.fillMaxWidth().aspectRatio(4f / 3f), { tileClick(t) }, { viewer = t }, compact = true) }
                        }
                    }
                } else {
                    Column(Modifier.fillMaxSize().padding(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        CallTileView(focusTile, speaking, receive, rtc.eglBase, frontCamera, Modifier.weight(1f).fillMaxWidth(), { tileClick(focusTile) }, { viewer = focusTile })
                        if (rest.isNotEmpty()) LazyRow(Modifier.fillMaxWidth().height(110.dp), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            items(rest, key = { it.key }) { t -> CallTileView(t, speaking, receive, rtc.eglBase, frontCamera, Modifier.fillMaxHeight().aspectRatio(4f / 3f), { tileClick(t) }, { viewer = t }, compact = true) }
                        }
                    }
                }
            } else {
                // Tiles share the whole area, so every participant stays visible with no scrolling at any call size.
                val cols = bestCallGridCols(tiles.size, (maxWidth - Spacing.sm * 2).value, (maxHeight - Spacing.sm * 2).value, Spacing.sm.value)
                Column(Modifier.fillMaxSize().padding(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    tiles.chunked(cols).forEach { row ->
                        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            row.forEach { t ->
                                key(t.key) {
                                    CallTileView(t, speaking, receive, rtc.eglBase, frontCamera, Modifier.weight(1f).fillMaxHeight(), { tileClick(t) }, { viewer = t }, compact = tiles.size > 2)
                                }
                            }
                        }
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.md), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            val err = MaterialTheme.colorScheme.error
            val prim = MaterialTheme.colorScheme.primary
            CoveIconButton(if (muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (muted) "Unmute" else "Mute", { rtc.toggleMute() }, variant = IconButtonVariant.Filled, size = 56.dp, iconSize = 26.dp, selected = muted, selectedColor = err)
            CoveIconButton(if (videoOn) Icons.Outlined.Videocam else Icons.Outlined.VideocamOff, if (videoOn) "Turn camera off" else "Turn camera on", { rtc.toggleVideo() }, variant = IconButtonVariant.Filled, size = 56.dp, iconSize = 26.dp, selected = videoOn, selectedColor = prim)
            CoveIconButton(if (sharing) Icons.Outlined.StopScreenShare else Icons.Outlined.ScreenShare, if (sharing) "Stop sharing" else "Share screen", { toggleShare() }, variant = IconButtonVariant.Filled, size = 56.dp, iconSize = 26.dp, selected = sharing, selectedColor = prim)
            CoveIconButton(Icons.Outlined.MoreHoriz, "More call options", { showMore = true }, variant = IconButtonVariant.Filled, size = 56.dp, iconSize = 26.dp)
            CoveIconButton(Icons.Outlined.CallEnd, "Leave call", { onCallEnded() }, variant = IconButtonVariant.Filled, size = 56.dp, iconSize = 26.dp, selected = true, selectedColor = err)
        }
    }

    if (showMore) CallOptionsSheet(onDismiss = { showMore = false })
    viewer?.let { v ->
        // Re-resolve so the viewer closes when the share ends.
        val live = tiles.firstOrNull { it.key == v.key }
        if (live == null) viewer = null else ScreenViewerDialog(live, rtc.eglBase, receive, onDismiss = { viewer = null })
    }
}

/**
 * Column count that makes grid cells closest to square for [count] tiles in a [width] x [height] box (dp), so
 * 2 people stack on a phone held upright, sit side by side in landscape, and larger calls tile evenly without
 * thin slivers. Ties go to fewer rows.
 */
internal fun bestCallGridCols(count: Int, width: Float, height: Float, gap: Float): Int {
    if (count <= 1 || width <= 0f || height <= 0f) return 1
    var best = 1
    var bestScore = -1f
    for (cols in 1..count) {
        val rows = (count + cols - 1) / cols
        val w = (width - gap * (cols - 1)) / cols
        val h = (height - gap * (rows - 1)) / rows
        if (w <= 0f || h <= 0f) continue
        val score = minOf(w / h, h / w)
        if (score > bestScore + 0.001f) { bestScore = score; best = cols }
    }
    return best
}

/** A participant (camera or avatar) or a shared screen, with name label, mute badge and the speaking ring. */
@Composable
internal fun CallTileView(
    tile: CallTile, speaking: Set<String>, receive: ReceiveQuality, egl: EglBase, frontCamera: Boolean,
    modifier: Modifier, onClick: () -> Unit, onFullscreen: () -> Unit, compact: Boolean = false
) {
    val c = CoveTheme.extendedColors
    val talks = !tile.isScreen && tile.userId in speaking
    Box(
        modifier.clip(CoveShapes.md).background(c.card)
            .border(if (talks) 3.dp else 1.dp, if (talks) c.success else c.border, CoveShapes.md)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        when {
            tile.track != null && tile.isScreen && receive == ReceiveQuality.Paused -> Text("Screen share paused", color = c.textMuted, fontSize = CoveType.label.fontSize)
            tile.track != null -> VideoRenderer(tile.track, egl, mirror = tile.isSelf && frontCamera, fit = tile.isScreen, fpsReduction = if (tile.isScreen) receive.fpsReduction else null, modifier = Modifier.fillMaxSize())
            else -> UserAvatar(tile.userId, size = if (compact) 48.dp else 80.dp)
        }
        Row(
            Modifier.align(Alignment.BottomStart).padding(Spacing.sm).clip(CoveShapes.sm).background(c.overlay).padding(horizontal = Spacing.sm, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (!tile.audioOn) {
                Icon(Icons.Outlined.MicOff, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
            }
            if (tile.isScreen) {
                Icon(Icons.Outlined.ScreenShare, null, tint = c.onOverlay, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(tile.name + if (tile.isSelf) " (you)" else "", color = c.onOverlay, fontSize = CoveType.caption.fontSize, fontWeight = FontWeight.Medium, maxLines = 1)
        }
        if (tile.isScreen) {
            CoveIconButton(Icons.Outlined.Fullscreen, "Full screen", onFullscreen, variant = IconButtonVariant.Scrim, size = 40.dp, iconSize = 22.dp, modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.xs))
        }
    }
}

/**
 * Hosts a libwebrtc [SurfaceViewRenderer] and attaches/detaches the track with the composable's lifetime. Cameras
 * fill their tile, screens are letterboxed (never cropped); [fpsReduction] throttles rendering of heavy screen streams.
 */
@Composable
internal fun VideoRenderer(track: VideoTrack, egl: EglBase, mirror: Boolean, fit: Boolean, fpsReduction: Float? = null, modifier: Modifier = Modifier, configure: (SurfaceViewRenderer) -> Unit = {}) {
    AndroidView(
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(egl.eglBaseContext, null)
                setEnableHardwareScaler(true)
                track.addSink(this)
            }
        },
        update = { view ->
            view.setScalingType(if (fit) RendererCommon.ScalingType.SCALE_ASPECT_FIT else RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            view.setMirror(mirror)
            if (fpsReduction != null) view.setFpsReduction(fpsReduction) else view.disableFpsReduction()
            configure(view)
        },
        onRelease = { view ->
            track.removeSink(view)
            view.release()
        },
        modifier = modifier
    )
}

