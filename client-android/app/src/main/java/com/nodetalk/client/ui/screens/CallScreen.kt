package com.nodetalk.client.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.rtc.CallParticipant
import com.nodetalk.client.service.CallService
import com.nodetalk.client.ui.components.UserAvatar
import com.nodetalk.client.ui.theme.NTDestructive
import com.nodetalk.client.ui.theme.NTPrimary
import com.nodetalk.client.ui.theme.NodeTalkTheme
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/** Group call (WebRTC SFU): participant tiles with live video where available, plus mute / camera / leave. */
@Composable
fun CallScreen(
    channelId: String,
    channelName: String,
    withVideo: Boolean,
    onCallEnded: () -> Unit
) {
    val context = LocalContext.current
    val c = NodeTalkTheme.extendedColors
    val rtc = NodeTalkApp.instance.webRTCManager

    val muted by rtc.isMuted.collectAsState()
    val videoOn by rtc.isVideoEnabled.collectAsState()
    val participants by rtc.participants.collectAsState()
    val remoteVideo by rtc.remoteVideo.collectAsState()
    val localVideo by rtc.localVideo.collectAsState()
    val selfId by rtc.selfId.collectAsState()
    val status by rtc.status.collectAsState()

    LaunchedEffect(channelId) {
        rtc.joinCall(channelId, withVideo)
        CallService.start(context, channelName)
    }
    // Leaving the screen (back gesture included) always ends the call and the foreground service.
    DisposableEffect(Unit) {
        onDispose {
            rtc.leaveCall()
            CallService.stop(context)
        }
    }

    Column(Modifier.fillMaxSize().background(c.chatCanvas).navigationBarsPadding()) {
        Column(Modifier.fillMaxWidth().background(c.card).statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp)) {
            Text(channelName, color = c.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text(
                if (status.isNotBlank()) status else "${participants.size} in call",
                color = if (status == "Connected") c.statusOnline else c.textMuted, fontSize = 13.sp
            )
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.weight(1f).fillMaxWidth().padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(participants, key = { it.userId }) { p ->
                val isSelf = p.userId == selfId
                val track = if (isSelf) localVideo.takeIf { videoOn } else remoteVideo[p.userId]?.takeIf { p.video }
                ParticipantTile(p, isSelf, track, rtc.eglBase)
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            ControlButton(if (muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, "Mute", active = muted, activeColor = NTDestructive) { rtc.toggleMute() }
            ControlButton(if (videoOn) Icons.Outlined.Videocam else Icons.Outlined.VideocamOff, "Camera", active = videoOn, activeColor = NTPrimary) { rtc.toggleVideo() }
            ControlButton(Icons.Outlined.CallEnd, "Leave call", active = true, activeColor = NTDestructive) { onCallEnded() }
        }
    }
}

@Composable
private fun ControlButton(icon: ImageVector, desc: String, active: Boolean, activeColor: Color, onClick: () -> Unit) {
    val c = NodeTalkTheme.extendedColors
    Box(
        Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).background(if (active) activeColor else c.card).border(1.dp, c.border, RoundedCornerShape(8.dp)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Icon(icon, desc, tint = if (active) Color.White else c.textPrimary) }
}

@Composable
private fun ParticipantTile(p: CallParticipant, isSelf: Boolean, track: VideoTrack?, egl: EglBase) {
    val c = NodeTalkTheme.extendedColors
    Box(
        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        if (track != null) {
            VideoRenderer(track, egl, mirror = isSelf)
        } else {
            UserAvatar(p.userId, size = 72.dp)
        }
        Row(
            Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (!p.audio) {
                Icon(Icons.Outlined.MicOff, null, tint = NTDestructive, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(p.username + if (isSelf) " (you)" else "", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        }
    }
}

/** Hosts a libwebrtc SurfaceViewRenderer and attaches/detaches the track with the composable's lifetime. */
@Composable
private fun VideoRenderer(track: VideoTrack, egl: EglBase, mirror: Boolean) {
    AndroidView(
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(egl.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                setMirror(mirror)
                track.addSink(this)
            }
        },
        onRelease = { view ->
            track.removeSink(view)
            view.release()
        },
        modifier = Modifier.fillMaxSize()
    )
}
