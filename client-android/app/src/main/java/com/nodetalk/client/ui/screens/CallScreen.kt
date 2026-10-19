package com.nodetalk.client.ui.screens

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nodetalk.client.NodeTalkApp
import com.nodetalk.client.service.CallService
import com.nodetalk.client.ui.theme.NodeTalkDarkBg
import com.nodetalk.client.ui.theme.NodeTalkDestructive
import com.nodetalk.client.ui.theme.NodeTalkOnline
import com.nodetalk.client.ui.theme.NodeTalkPrimary
import com.nodetalk.client.ui.theme.NodeTalkSurface
import com.nodetalk.client.ui.theme.NodeTalkTextPrimary
import com.nodetalk.client.ui.theme.NodeTalkTextSecondary

@Composable
fun CallScreen(
    channelId: String,
    channelName: String,
    withVideo: Boolean,
    onCallEnded: () -> Unit
) {
    val context = LocalContext.current
    val rtc = NodeTalkApp.instance.webRTCManager

    val isMuted by rtc.isMuted.collectAsState()
    val isVideoEnabled by rtc.isVideoEnabled.collectAsState()
    val participants by rtc.participants.collectAsState()

    LaunchedEffect(channelId) {
        rtc.joinCall(channelId, withVideo)
        CallService.start(context, channelName)
    }

    DisposableEffect(Unit) {
        onDispose {
            CallService.stop(context)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(NodeTalkDarkBg)
    ) {
        // Center Stage Information
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .background(NodeTalkSurface, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = channelName.take(2).uppercase(),
                    fontSize = 32.sp,
                    color = NodeTalkTextPrimary
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = channelName,
                fontSize = 22.sp,
                color = NodeTalkTextPrimary,
                style = MaterialTheme.typography.titleLarge
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "WebRTC SFU Group Call",
                fontSize = 14.sp,
                color = NodeTalkOnline
            )

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = "${participants.size + 1} participant(s) in call",
                fontSize = 13.sp,
                color = NodeTalkTextSecondary
            )
        }

        // Bottom Call Action Controls
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(bottom = 48.dp, start = 24.dp, end = 24.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Mute / Unmute
            IconButton(
                onClick = { rtc.toggleMute() },
                modifier = Modifier
                    .size(56.dp)
                    .background(if (isMuted) NodeTalkDestructive else NodeTalkSurface, CircleShape)
            ) {
                Icon(
                    imageVector = if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                    contentDescription = "Mute",
                    tint = NodeTalkTextPrimary
                )
            }

            // Video Toggle
            IconButton(
                onClick = { rtc.toggleVideo() },
                modifier = Modifier
                    .size(56.dp)
                    .background(if (isVideoEnabled) NodeTalkPrimary else NodeTalkSurface, CircleShape)
            ) {
                Icon(
                    imageVector = if (isVideoEnabled) Icons.Default.Videocam else Icons.Default.VideocamOff,
                    contentDescription = "Video",
                    tint = NodeTalkTextPrimary
                )
            }

            // Hang Up (Leave)
            IconButton(
                onClick = {
                    rtc.leaveCall()
                    CallService.stop(context)
                    onCallEnded()
                },
                modifier = Modifier
                    .size(56.dp)
                    .background(NodeTalkDestructive, CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.CallEnd,
                    contentDescription = "Leave Call",
                    tint = NodeTalkTextPrimary
                )
            }
        }
    }
}
