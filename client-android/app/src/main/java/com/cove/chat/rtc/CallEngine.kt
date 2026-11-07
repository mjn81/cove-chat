package com.cove.chat.rtc

import android.content.Intent
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import org.webrtc.VideoTrack

/** How a call's media travels. The UI is identical for both; only the server decides (`voice.mode`). */
enum class CallTransport { WebRtc, EncryptedUdp }

/**
 * Pure transport choice from the server's capability list (`GET /api/version`, docs/udp-media.md section 8).
 * Clients decide from capabilities, never from a version number. A server that lists `raw_udp_media` and no
 * `webrtc_sfu` only speaks the encrypted UDP protocol; everything else (including an old server with no list) keeps
 * the WebRTC path unchanged.
 */
object CallTransportChoice {
    const val CAP_WEBRTC = "webrtc_sfu"
    const val CAP_UDP_MEDIA = "raw_udp_media"

    fun forCapabilities(capabilities: List<String>?): CallTransport {
        val caps = capabilities.orEmpty()
        return if (CAP_UDP_MEDIA in caps && CAP_WEBRTC !in caps) CallTransport.EncryptedUdp else CallTransport.WebRtc
    }
}

/**
 * Everything the call UI, the call notification and the call coordinator use from a running call. Implemented by
 * [WebRtcEngine] (the in-process SFU, internet mode) and `UdpCallManager` (encrypted UDP, air-gapped mode), and
 * switched per call by [CallRouter], so screens never know which transport is in use.
 */
interface CallEngine {
    val isInCall: StateFlow<Boolean>
    val isMuted: StateFlow<Boolean>
    /** True while all incoming call audio is silenced (web "deafen"). */
    val isDeafened: StateFlow<Boolean>
    val isVideoEnabled: StateFlow<Boolean>
    /** Which camera is in use; the local preview is mirrored only for the front one. */
    val isFrontCamera: StateFlow<Boolean>
    val isScreenSharing: StateFlow<Boolean>
    val selfId: StateFlow<String?>
    val participants: StateFlow<List<CallParticipant>>
    val remoteVideo: StateFlow<Map<String, VideoTrack>>
    /** Other participants' shared screens, keyed by the sharer's user id. */
    val remoteScreens: StateFlow<Map<String, VideoTrack>>
    val localVideo: StateFlow<VideoTrack?>
    val localScreen: StateFlow<VideoTrack?>
    /** User ids currently talking. */
    val speaking: StateFlow<Set<String>>
    /** Human-readable connection state or server error for the call screen. */
    val status: StateFlow<String>
    val cameraQuality: StateFlow<CameraQuality>
    val screenQuality: StateFlow<ScreenQuality>
    val adaptiveQuality: StateFlow<Boolean>
    /** True while adaptive quality has degraded the outgoing video. */
    val networkPoor: StateFlow<Boolean>
    val receiveQuality: StateFlow<ReceiveQuality>
    /** `SystemClock.elapsedRealtime()` when the call started, for the notification chronometer. */
    val callStartedAt: Long
    /** Shared EGL context: video tiles render frames that live in it. */
    val eglBase: EglBase
    /** Chooses earpiece / speaker / Bluetooth / headset output. */
    val audioRouter: CallAudioRouter

    fun joinCall(channel: String, enableVideo: Boolean = false)
    fun toggleMute()
    fun toggleDeafen()
    fun toggleVideo()
    fun switchCamera()
    /** [permission] is the MediaProjection consent result; the call foreground service must already be running. */
    fun startScreenShare(permission: Intent): Boolean
    fun stopScreenShare(notify: Boolean = true)
    fun setCameraQuality(q: CameraQuality)
    fun setScreenQuality(q: ScreenQuality)
    fun setAdaptiveQuality(on: Boolean)
    fun setReceiveQuality(q: ReceiveQuality)
    /** Asks for a fresh keyframe from [userId] (every publisher when null). */
    fun requestKeyframe(userId: String?)
    fun leaveCall()
}

/** Plain delegation of the existing WebRTC manager to [CallEngine], so that class stays untouched. */
class WebRtcEngine(private val rtc: WebRTCManager) : CallEngine {
    override val isInCall get() = rtc.isInCall
    override val isMuted get() = rtc.isMuted
    override val isDeafened get() = rtc.isDeafened
    override val isVideoEnabled get() = rtc.isVideoEnabled
    override val isFrontCamera get() = rtc.isFrontCamera
    override val isScreenSharing get() = rtc.isScreenSharing
    override val selfId get() = rtc.selfId
    override val participants get() = rtc.participants
    override val remoteVideo get() = rtc.remoteVideo
    override val remoteScreens get() = rtc.remoteScreens
    override val localVideo get() = rtc.localVideo
    override val localScreen get() = rtc.localScreen
    override val speaking get() = rtc.speaking
    override val status get() = rtc.status
    override val cameraQuality get() = rtc.cameraQuality
    override val screenQuality get() = rtc.screenQuality
    override val adaptiveQuality get() = rtc.adaptiveQuality
    override val networkPoor get() = rtc.networkPoor
    override val receiveQuality get() = rtc.receiveQuality
    override val callStartedAt get() = rtc.callStartedAt
    override val eglBase get() = rtc.eglBase
    override val audioRouter get() = rtc.audioRouter

    override fun joinCall(channel: String, enableVideo: Boolean) = rtc.joinCall(channel, enableVideo)
    override fun toggleMute() = rtc.toggleMute()
    override fun toggleDeafen() = rtc.toggleDeafen()
    override fun toggleVideo() = rtc.toggleVideo()
    override fun switchCamera() = rtc.switchCamera()
    override fun startScreenShare(permission: Intent) = rtc.startScreenShare(permission)
    override fun stopScreenShare(notify: Boolean) = rtc.stopScreenShare(notify)
    override fun setCameraQuality(q: CameraQuality) = rtc.setCameraQuality(q)
    override fun setScreenQuality(q: ScreenQuality) = rtc.setScreenQuality(q)
    override fun setAdaptiveQuality(on: Boolean) = rtc.setAdaptiveQuality(on)
    override fun setReceiveQuality(q: ReceiveQuality) = rtc.setReceiveQuality(q)
    override fun requestKeyframe(userId: String?) = rtc.requestKeyframe(userId)
    override fun leaveCall() = rtc.leaveCall()
}
