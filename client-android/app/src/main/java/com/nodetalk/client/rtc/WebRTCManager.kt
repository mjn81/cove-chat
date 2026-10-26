package com.nodetalk.client.rtc

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.nodetalk.client.CoveApp
import com.nodetalk.client.data.remote.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** One person in the call, with the audio/video flags the SFU rebroadcasts via `call_track_state`. */
data class CallParticipant(val userId: String, val username: String, val audio: Boolean, val video: Boolean)

/**
 * Client side of Cove's in-process WebRTC SFU. Mirrors client-web/src/rtc/WebRTCManager.ts and the
 * protocol in backend/internal/rtc/signaling_types.go: two PeerConnections, one that publishes our mic/camera
 * and one that receives everyone else's forwarded tracks, with the server always the offerer on the latter.
 */
class WebRTCManager(
    private val context: Context,
    private val wsManager: WebSocketManager
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val tag = "RTC"

    val eglBase: EglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null

    private var publishPc: PeerConnection? = null
    private var subscribePc: PeerConnection? = null
    private var localAudio: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null
    private var capturer: VideoCapturer? = null
    private var textureHelper: SurfaceTextureHelper? = null

    private var channelId: String? = null
    private var pendingSubscribeOffer: SessionDescription? = null
    private val pendingPublishIce = mutableListOf<IceCandidate>()
    private val pendingSubscribeIce = mutableListOf<IceCandidate>()
    private var publishRemoteSet = false
    private var subscribeRemoteSet = false
    private val subscribeLock = Mutex()
    private var previousAudioMode = AudioManager.MODE_NORMAL
    private var previousSpeaker = false

    private val _inCall = MutableStateFlow(false)
    val isInCall: StateFlow<Boolean> = _inCall.asStateFlow()
    private val _muted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _muted.asStateFlow()
    private val _videoOn = MutableStateFlow(false)
    val isVideoEnabled: StateFlow<Boolean> = _videoOn.asStateFlow()
    private val _selfId = MutableStateFlow<String?>(null)
    val selfId: StateFlow<String?> = _selfId.asStateFlow()
    private val _participants = MutableStateFlow<List<CallParticipant>>(emptyList())
    val participants: StateFlow<List<CallParticipant>> = _participants.asStateFlow()
    private val _remoteVideo = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    val remoteVideo: StateFlow<Map<String, VideoTrack>> = _remoteVideo.asStateFlow()
    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()
    private val _status = MutableStateFlow("")
    /** Human-readable connection state or server error for the call screen. */
    val status: StateFlow<String> = _status.asStateFlow()

    init {
        val opts = PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
        PeerConnectionFactory.initialize(opts)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
        scope.launch { wsManager.signalingFlow.collect { (type, payload) -> runCatching { onSignal(type, payload.jsonObject) }.onFailure { Log.e(tag, "signal $type failed", it) } } }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Sends `call_join`; everything else follows from the server's `call_joined`. */
    fun joinCall(channel: String, enableVideo: Boolean = false) {
        if (_inCall.value) return
        channelId = channel
        _inCall.value = true
        _videoOn.value = enableVideo
        _status.value = "Connecting…"
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        previousAudioMode = audio.mode
        previousSpeaker = audio.isSpeakerphoneOn
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.isSpeakerphoneOn = true
        scope.launch {
            val ok = wsManager.sendSignaling("call_join", buildJsonObject { put("channel_id", channel) })
            if (!ok) { _status.value = "Not connected to the server."; }
        }
    }

    fun toggleMute() {
        val muted = !_muted.value
        _muted.value = muted
        localAudio?.setEnabled(!muted)
        sendTrackState("audio", !muted, localAudio?.id())
        updateSelf { it.copy(audio = !muted) }
    }

    fun toggleVideo() {
        val enable = !_videoOn.value
        _videoOn.value = enable
        if (enable) {
            if (localVideoTrack == null) { startCamera(); publishOffer() } else localVideoTrack?.setEnabled(true)
        } else {
            localVideoTrack?.setEnabled(false)
        }
        sendTrackState("video", enable, localVideoTrack?.id())
        updateSelf { it.copy(video = enable) }
    }

    fun leaveCall() {
        channelId?.let { id -> scope.launch { wsManager.sendSignaling("call_leave", buildJsonObject { put("channel_id", id) }) } }
        cleanup()
    }

    // ── Signaling ─────────────────────────────────────────────────────────────

    private fun str(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.contentOrNull

    private fun sdpOf(o: JsonObject, type: SessionDescription.Type): SessionDescription? {
        val sdp = (o["sdp"] as? JsonObject)?.let { str(it, "sdp") } ?: return null
        return SessionDescription(type, sdp)
    }

    private suspend fun onSignal(type: String, p: JsonObject) {
        when (type) {
            "call_joined" -> onJoined(p)
            "call_publish_answer" -> {
                val answer = sdpOf(p, SessionDescription.Type.ANSWER) ?: return
                publishPc?.let { pc ->
                    pc.setRemote(answer)
                    publishRemoteSet = true
                    pendingPublishIce.forEach { pc.addIceCandidate(it) }
                    pendingPublishIce.clear()
                }
            }
            "call_subscribe_offer" -> {
                val offer = sdpOf(p, SessionDescription.Type.OFFER) ?: return
                if (subscribePc == null) pendingSubscribeOffer = offer else answerSubscribeOffer(offer)
            }
            "call_ice_candidate" -> {
                val c = p["candidate"] as? JsonObject ?: return
                val cand = IceCandidate(str(c, "sdpMid"), (c["sdpMLineIndex"] as? JsonPrimitive)?.intOrNull ?: 0, str(c, "candidate") ?: return)
                val publish = str(p, "target") == "publish"
                val pc = if (publish) publishPc else subscribePc
                val ready = if (publish) publishRemoteSet else subscribeRemoteSet
                if (pc != null && ready) pc.addIceCandidate(cand) else (if (publish) pendingPublishIce else pendingSubscribeIce).add(cand)
            }
            "call_participant_joined" -> parseParticipant(p["user"] as? JsonObject)?.let { np ->
                _participants.update { list -> list.filterNot { it.userId == np.userId } + np }
            }
            "call_participant_left" -> {
                val id = (p["user"] as? JsonObject)?.let { str(it, "user_id") } ?: return
                _participants.update { list -> list.filterNot { it.userId == id } }
                _remoteVideo.update { it - id }
            }
            "call_track_state" -> {
                val uid = str(p, "user_id") ?: return
                val kind = str(p, "kind") ?: return
                val on = (p["enabled"] as? JsonPrimitive)?.booleanOrNull ?: return
                _participants.update { list ->
                    list.map { if (it.userId == uid) when (kind) { "audio" -> it.copy(audio = on); "video" -> it.copy(video = on); else -> it } else it }
                }
            }
            "call_error" -> _status.value = str(p, "error") ?: "Call error"
        }
    }

    private fun parseParticipant(o: JsonObject?): CallParticipant? {
        o ?: return null
        val id = str(o, "user_id") ?: return null
        val states = o["track_states"] as? JsonObject
        fun flag(k: String, def: Boolean) = (states?.get(k) as? JsonPrimitive)?.booleanOrNull ?: def
        return CallParticipant(id, str(o, "username") ?: "User", flag("audio", true), flag("video", false))
    }

    private suspend fun onJoined(p: JsonObject) {
        _selfId.value = str(p, "self_id")
        val roster = (p["participants"] as? JsonArray)?.mapNotNull { parseParticipant(it as? JsonObject) }.orEmpty()
        val me = CoveApp.instance.preferencesManager
        val self = CallParticipant(str(p, "self_id") ?: me.userId.orEmpty(), me.username ?: "me", audio = !_muted.value, video = _videoOn.value)
        _participants.value = roster.filter { it.userId != self.userId } + self

        val ice = (p["ice_servers"] as? JsonArray)?.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val urls = (o["urls"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: return@mapNotNull null
            PeerConnection.IceServer.builder(urls).apply {
                str(o, "username")?.let { setUsername(it) }
                str(o, "credential")?.let { setPassword(it) }
            }.createIceServer()
        }.orEmpty()
        val config = PeerConnection.RTCConfiguration(ice).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        val f = factory ?: return

        publishRemoteSet = false
        subscribeRemoteSet = false
        publishPc = f.createPeerConnection(config, object : SimplePeerConnectionObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) { candidate?.let { sendCandidate(it, "publish") } }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
                Log.d(tag, "publish connection: $state")
                if (state == PeerConnection.PeerConnectionState.CONNECTED) _status.value = "Connected"
            }
        })
        subscribePc = f.createPeerConnection(config, object : SimplePeerConnectionObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) { candidate?.let { sendCandidate(it, "subscribe") } }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) { Log.d(tag, "subscribe connection: $state") }
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {
                receiver?.let { onRemoteTrack(it, mediaStreams?.firstOrNull()?.id.orEmpty()) }
            }
        })

        // Local microphone (mute/echo/noise preferences come from Settings > Voice & Video)
        val prefs = me
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", prefs.echoCancellation.toString()))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", prefs.noiseSuppression.toString()))
        }
        val audioSource = f.createAudioSource(constraints)
        localAudio = f.createAudioTrack("audio-${self.userId}", audioSource)
        _muted.value = prefs.joinCallsMuted
        localAudio?.setEnabled(!_muted.value)
        publishPc?.addTrack(localAudio, listOf(self.userId))
        if (_videoOn.value) startCamera()
        publishOffer()
        if (_muted.value) sendTrackState("audio", false, localAudio?.id())

        pendingSubscribeOffer?.let { pendingSubscribeOffer = null; answerSubscribeOffer(it) }
        scope.launch { logInboundStats() }
    }

    /** Debug aid: periodically logs how many RTP packets the subscribe connection has received. */
    private suspend fun logInboundStats() {
        while (_inCall.value) {
            kotlinx.coroutines.delay(3000)
            subscribePc?.getStats { report ->
                report.statsMap.values.filter { it.type == "inbound-rtp" }.forEach {
                    Log.d(tag, "inbound ${it.members["kind"]} packets=${it.members["packetsReceived"]} bytes=${it.members["bytesReceived"]}")
                }
            }
        }
    }

    private fun onRemoteTrack(receiver: RtpReceiver, streamId: String) {
        val track = receiver.track() ?: return
        Log.d(tag, "remote track kind=${track.kind()} stream=$streamId")
        if (track is VideoTrack && !streamId.contains("screen")) {
            _remoteVideo.update { it + (streamId to track) }
            requestKeyframe(streamId)
            scope.launch { kotlinx.coroutines.delay(300); requestKeyframe(streamId) }
        }
        // Audio tracks play through the system automatically once attached to the PeerConnection.
    }

    private fun requestKeyframe(userId: String) {
        val ch = channelId ?: return
        scope.launch { wsManager.sendSignaling("call_request_keyframe", buildJsonObject { put("channel_id", ch); put("user_id", userId) }) }
    }

    /** (Re)creates the publish offer; called after join and whenever a new local track is added. */
    private fun publishOffer() {
        val pc = publishPc ?: return
        val ch = channelId ?: return
        scope.launch {
            runCatching {
                val offer = pc.createOffer(MediaConstraints())
                pc.setLocal(offer)
                wsManager.sendSignaling("call_publish_offer", buildJsonObject {
                    put("channel_id", ch)
                    put("sdp", buildJsonObject { put("type", "offer"); put("sdp", offer.description) })
                })
            }.onFailure { Log.e(tag, "publish offer failed", it); _status.value = "Couldn't start the call." }
        }
    }

    private suspend fun answerSubscribeOffer(offer: SessionDescription) { subscribeLock.withLock {
        val pc = subscribePc ?: return@withLock
        val ch = channelId ?: return@withLock
        pc.setRemote(offer)
        subscribeRemoteSet = true
        pendingSubscribeIce.forEach { pc.addIceCandidate(it) }
        pendingSubscribeIce.clear()
        val answer = pc.createAnswer(MediaConstraints())
        pc.setLocal(answer)
        wsManager.sendSignaling("call_subscribe_answer", buildJsonObject {
            put("channel_id", ch)
            put("sdp", buildJsonObject { put("type", "answer"); put("sdp", answer.description) })
        })
    } }

    private fun sendCandidate(c: IceCandidate, target: String) {
        val ch = channelId ?: return
        scope.launch {
            wsManager.sendSignaling("call_ice_candidate", buildJsonObject {
                put("channel_id", ch)
                put("target", target)
                put("candidate", buildJsonObject {
                    put("candidate", c.sdp)
                    put("sdpMid", c.sdpMid ?: "")
                    put("sdpMLineIndex", c.sdpMLineIndex)
                })
            })
        }
    }

    private fun sendTrackState(kind: String, enabled: Boolean, trackId: String?) {
        val ch = channelId ?: return
        scope.launch {
            wsManager.sendSignaling("call_track_state", buildJsonObject {
                put("channel_id", ch); put("kind", kind); put("enabled", enabled)
                trackId?.let { put("track_id", it) }
                _selfId.value?.let { put("stream_id", it) }
            })
        }
    }

    private fun updateSelf(change: (CallParticipant) -> CallParticipant) {
        val me = _selfId.value ?: return
        _participants.update { list -> list.map { if (it.userId == me) change(it) else it } }
    }

    private fun startCamera() {
        val f = factory ?: return
        val enumerator = Camera2Enumerator(context)
        val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: enumerator.deviceNames.firstOrNull() ?: return
        val cap = enumerator.createCapturer(name, null) ?: return
        textureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        val source = f.createVideoSource(cap.isScreencast)
        cap.initialize(textureHelper, context, source.capturerObserver)
        cap.startCapture(640, 480, 24)
        capturer = cap
        localVideoTrack = f.createVideoTrack("video-${_selfId.value}", source).also {
            publishPc?.addTrack(it, listOf(_selfId.value ?: "self"))
        }
        _localVideo.value = localVideoTrack
    }

    private fun cleanup() {
        runCatching { capturer?.stopCapture() }
        capturer?.dispose(); capturer = null
        textureHelper?.dispose(); textureHelper = null
        publishPc?.dispose(); subscribePc?.dispose()
        publishPc = null; subscribePc = null
        localAudio = null; localVideoTrack = null
        pendingSubscribeOffer = null
        pendingPublishIce.clear(); pendingSubscribeIce.clear()
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.mode = previousAudioMode
        audio.isSpeakerphoneOn = previousSpeaker
        _inCall.value = false; _muted.value = false; _videoOn.value = false
        _participants.value = emptyList(); _remoteVideo.value = emptyMap(); _localVideo.value = null
        _selfId.value = null; _status.value = ""
        channelId = null
    }
}

// ── Suspend wrappers around libwebrtc's callback-style SDP API ────────────────

private suspend fun PeerConnection.createOffer(c: MediaConstraints): SessionDescription = suspendCancellableCoroutine { k ->
    createOffer(object : SimpleSdpObserver() {
        override fun onCreateSuccess(desc: SessionDescription?) { desc?.let { k.resume(it) } ?: k.resumeWithException(IllegalStateException("empty offer")) }
        override fun onCreateFailure(error: String?) { k.resumeWithException(IllegalStateException(error)) }
    }, c)
}

private suspend fun PeerConnection.createAnswer(c: MediaConstraints): SessionDescription = suspendCancellableCoroutine { k ->
    createAnswer(object : SimpleSdpObserver() {
        override fun onCreateSuccess(desc: SessionDescription?) { desc?.let { k.resume(it) } ?: k.resumeWithException(IllegalStateException("empty answer")) }
        override fun onCreateFailure(error: String?) { k.resumeWithException(IllegalStateException(error)) }
    }, c)
}

private suspend fun PeerConnection.setLocal(d: SessionDescription): Unit = suspendCancellableCoroutine { k ->
    setLocalDescription(object : SimpleSdpObserver() {
        override fun onSetSuccess() { k.resume(Unit) }
        override fun onSetFailure(error: String?) { k.resumeWithException(IllegalStateException(error)) }
    }, d)
}

private suspend fun PeerConnection.setRemote(d: SessionDescription): Unit = suspendCancellableCoroutine { k ->
    setRemoteDescription(object : SimpleSdpObserver() {
        override fun onSetSuccess() { k.resume(Unit) }
        override fun onSetFailure(error: String?) { k.resumeWithException(IllegalStateException(error)) }
    }, d)
}

open class SimplePeerConnectionObserver : PeerConnection.Observer {
    override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
    override fun onIceCandidate(candidate: IceCandidate?) {}
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
    override fun onAddStream(stream: MediaStream?) {}
    override fun onRemoveStream(stream: MediaStream?) {}
    override fun onDataChannel(channel: org.webrtc.DataChannel?) {}
    override fun onRenegotiationNeeded() {}
    override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
}

open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription?) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) {}
    override fun onSetFailure(error: String?) {}
}
