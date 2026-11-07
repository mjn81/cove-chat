package com.cove.chat.rtc

import android.content.Context
import android.content.Intent
import com.cove.chat.data.local.PreferencesManager
import com.cove.chat.data.model.ServerVersion
import com.cove.chat.data.remote.ApiClient
import com.cove.chat.data.remote.WebSocketManager
import com.cove.chat.rtc.udp.UdpCallManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The single [CallEngine] the app talks to. Each call is routed to one of two engines depending on the server:
 * the in-process WebRTC SFU (default; `webrtc_sfu` capability) or the encrypted UDP media client for air-gapped
 * `raw_udp` servers (`raw_udp_media`, no `webrtc_sfu`). The choice is made once per call, from the capabilities in
 * `GET /api/version` (see [CallTransportChoice]); a running call stays on its engine. Every observable property
 * follows whichever engine is active, so screens, the call notification and the incoming-call logic are unchanged.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CallRouter(
    context: Context,
    wsManager: WebSocketManager,
    prefs: PreferencesManager,
    private val api: ApiClient,
    webRtc: WebRTCManager,
) : CallEngine {
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())
    private val web: CallEngine = WebRtcEngine(webRtc)
    private var lastVersion: ServerVersion? = null
    private val udp: CallEngine by lazy {
        UdpCallManager(context.applicationContext, wsManager, prefs, web.eglBase, web.audioRouter) { lastVersion }
    }

    private val active = MutableStateFlow(web)
    private val picking = MutableStateFlow(false)
    private var pickJob: Job? = null

    private fun <T> follow(sel: (CallEngine) -> StateFlow<T>): StateFlow<T> =
        active.flatMapLatest { sel(it) }.stateIn(scope, SharingStarted.Eagerly, sel(web).value)

    override val isInCall: StateFlow<Boolean> =
        combine(picking, follow { it.isInCall }) { pending, live -> pending || live }.stateIn(scope, SharingStarted.Eagerly, false)
    override val isMuted = follow { it.isMuted }
    override val isDeafened = follow { it.isDeafened }
    override val isVideoEnabled = follow { it.isVideoEnabled }
    override val isFrontCamera = follow { it.isFrontCamera }
    override val isScreenSharing = follow { it.isScreenSharing }
    override val selfId = follow { it.selfId }
    override val participants = follow { it.participants }
    override val remoteVideo = follow { it.remoteVideo }
    override val remoteScreens = follow { it.remoteScreens }
    override val localVideo = follow { it.localVideo }
    override val localScreen = follow { it.localScreen }
    override val speaking = follow { it.speaking }
    override val status = follow { it.status }
    override val cameraQuality = follow { it.cameraQuality }
    override val screenQuality = follow { it.screenQuality }
    override val adaptiveQuality = follow { it.adaptiveQuality }
    override val networkPoor = follow { it.networkPoor }
    override val receiveQuality = follow { it.receiveQuality }
    override val callStartedAt: Long get() = active.value.callStartedAt
    override val eglBase get() = web.eglBase
    override val audioRouter get() = web.audioRouter

    override fun joinCall(channel: String, enableVideo: Boolean) {
        if (isInCall.value) return
        picking.value = true
        pickJob = scope.launch {
            // One quick look at the server's capabilities; if it cannot be reached, fall back to the WebRTC path that
            // has always been the default (its own error handling then reports the failure).
            val version = withTimeoutOrNull(VERSION_TIMEOUT_MS) { withContext(Dispatchers.IO) { api.getVersion().getOrNull() } }
            if (version != null) lastVersion = version
            val transport = CallTransportChoice.forCapabilities((version ?: lastVersion)?.capabilities)
            val engine = if (transport == CallTransport.EncryptedUdp) udp else web
            active.value = engine
            engine.joinCall(channel, enableVideo)
            picking.value = false
        }
    }

    override fun leaveCall() {
        pickJob?.cancel()
        picking.value = false
        active.value.leaveCall()
    }

    override fun toggleMute() = active.value.toggleMute()
    override fun toggleDeafen() = active.value.toggleDeafen()
    override fun toggleVideo() = active.value.toggleVideo()
    override fun switchCamera() = active.value.switchCamera()
    override fun startScreenShare(permission: Intent) = active.value.startScreenShare(permission)
    override fun stopScreenShare(notify: Boolean) = active.value.stopScreenShare(notify)
    override fun setCameraQuality(q: CameraQuality) = active.value.setCameraQuality(q)
    override fun setScreenQuality(q: ScreenQuality) = active.value.setScreenQuality(q)
    override fun setAdaptiveQuality(on: Boolean) = active.value.setAdaptiveQuality(on)
    override fun setReceiveQuality(q: ReceiveQuality) = active.value.setReceiveQuality(q)
    override fun requestKeyframe(userId: String?) = active.value.requestKeyframe(userId)

    private companion object {
        const val VERSION_TIMEOUT_MS = 3_000L
    }
}
