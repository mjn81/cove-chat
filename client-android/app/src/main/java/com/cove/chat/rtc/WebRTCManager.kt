package com.cove.chat.rtc

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.net.ConnectivityManager
import android.net.Network
import android.os.SystemClock
import android.util.Log
import com.cove.chat.CoveApp
import com.cove.chat.data.remote.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
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
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsReport
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** One person in the call, with the audio/video/screen flags the SFU rebroadcasts via `call_track_state`. */
data class CallParticipant(val userId: String, val username: String, val audio: Boolean, val video: Boolean, val screen: Boolean = false)

/**
 * Client side of Cove's in-process WebRTC SFU. Mirrors client-web/src/rtc/WebRTCManager.ts and the
 * protocol in backend/internal/rtc/signaling_types.go: two PeerConnections, one that publishes our mic/camera/screen
 * and one that receives everyone else's forwarded tracks, with the server always the offerer on the latter.
 *
 * Stream ids follow the server's `classifyTrack`: camera and mic use our user id, the screen share uses the stream
 * id `screen` (forwarded to others as `<userId>:screen`). Publish offers are strictly one at a time (see [publishOffer]).
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
    private var screenTrack: VideoTrack? = null
    private var screenCapturer: VideoCapturer? = null
    private var screenHelper: SurfaceTextureHelper? = null
    private var cameraSender: RtpSender? = null
    private var screenSender: RtpSender? = null

    private var channelId: String? = null
    private var pendingSubscribeOffer: SessionDescription? = null
    private val pendingPublishIce = mutableListOf<IceCandidate>()
    private val pendingSubscribeIce = mutableListOf<IceCandidate>()
    private var publishRemoteSet = false
    private var subscribeRemoteSet = false
    private val subscribeLock = Mutex()
    private var offering = false
    private var renegotiationPending = false
    private val remoteAudio = ConcurrentHashMap<String, AudioTrack>()
    private val audioTrackOwner = ConcurrentHashMap<String, String>()
    private val videoTrackOwner = ConcurrentHashMap<String, String>()
    private val lastFrames = HashMap<String, Long>()
    private val speakingHang = HashMap<String, Int>()
    private var statsJob: Job? = null
    private var failJob: Job? = null
    private var rejoining = false
    private var wsWasDown = false
    private var networkLost = false
    private var lastNetwork: Network? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var adaptLevel = 0
    private var calmSamples = 0
    private var lastKeyframeAt = HashMap<String, Long>()

    /** Chooses earpiece / speaker / Bluetooth / headset output. */
    val audioRouter = CallAudioRouter(context)

    private val _inCall = MutableStateFlow(false)
    val isInCall: StateFlow<Boolean> = _inCall.asStateFlow()
    private val _muted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _muted.asStateFlow()
    private val _deafened = MutableStateFlow(false)
    /** True while all incoming call audio is silenced (web "deafen"). */
    val isDeafened: StateFlow<Boolean> = _deafened.asStateFlow()
    private val _videoOn = MutableStateFlow(false)
    val isVideoEnabled: StateFlow<Boolean> = _videoOn.asStateFlow()
    private val _frontCamera = MutableStateFlow(true)
    /** Which camera is in use; the local preview is mirrored only for the front one. */
    val isFrontCamera: StateFlow<Boolean> = _frontCamera.asStateFlow()
    private val _screenSharing = MutableStateFlow(false)
    val isScreenSharing: StateFlow<Boolean> = _screenSharing.asStateFlow()
    private val _selfId = MutableStateFlow<String?>(null)
    val selfId: StateFlow<String?> = _selfId.asStateFlow()
    private val _participants = MutableStateFlow<List<CallParticipant>>(emptyList())
    val participants: StateFlow<List<CallParticipant>> = _participants.asStateFlow()
    private val _remoteVideo = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    val remoteVideo: StateFlow<Map<String, VideoTrack>> = _remoteVideo.asStateFlow()
    private val _remoteScreens = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    /** Other participants' shared screens, keyed by the sharer's user id. */
    val remoteScreens: StateFlow<Map<String, VideoTrack>> = _remoteScreens.asStateFlow()
    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()
    private val _localScreen = MutableStateFlow<VideoTrack?>(null)
    val localScreen: StateFlow<VideoTrack?> = _localScreen.asStateFlow()
    private val _speaking = MutableStateFlow<Set<String>>(emptySet())
    /** User ids currently talking (audio level above a threshold, with a short hang time like the web client). */
    val speaking: StateFlow<Set<String>> = _speaking.asStateFlow()
    private val _status = MutableStateFlow("")
    /** Human-readable connection state or server error for the call screen. */
    val status: StateFlow<String> = _status.asStateFlow()
    private val _cameraQuality = MutableStateFlow(CameraQuality.Medium)
    val cameraQuality: StateFlow<CameraQuality> = _cameraQuality.asStateFlow()
    private val _screenQuality = MutableStateFlow(ScreenQuality.Balanced)
    val screenQuality: StateFlow<ScreenQuality> = _screenQuality.asStateFlow()
    private val _adaptive = MutableStateFlow(true)
    /** When on, the sender steps bitrate/fps/resolution down on a poor network and back up when it recovers. */
    val adaptiveQuality: StateFlow<Boolean> = _adaptive.asStateFlow()
    private val _networkPoor = MutableStateFlow(false)
    /** True while adaptive quality has degraded the outgoing video. */
    val networkPoor: StateFlow<Boolean> = _networkPoor.asStateFlow()
    private val _receiveQuality = MutableStateFlow(ReceiveQuality.Full)
    val receiveQuality: StateFlow<ReceiveQuality> = _receiveQuality.asStateFlow()

    /** `SystemClock.elapsedRealtime()` when the call was started, for the notification chronometer. */
    var callStartedAt = 0L
        private set

    init {
        val opts = PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
        PeerConnectionFactory.initialize(opts)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
        scope.launch { wsManager.signalingFlow.collect { (type, payload) -> runCatching { onSignal(type, payload.jsonObject) }.onFailure { Log.e(tag, "signal $type failed", it) } } }
        // A dropped and re-established socket means the server already removed us from the room: join again.
        scope.launch {
            wsManager.connectionState.collect { up ->
                if (!up && _inCall.value) wsWasDown = true
                else if (up && wsWasDown && _inCall.value) { wsWasDown = false; rejoin("socket reconnected") }
            }
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Sends `call_join`; everything else follows from the server's `call_joined`. */
    fun joinCall(channel: String, enableVideo: Boolean = false) {
        if (_inCall.value) return
        channelId = channel
        _inCall.value = true
        _videoOn.value = enableVideo
        _deafened.value = false
        adaptLevel = 0; calmSamples = 0
        callStartedAt = SystemClock.elapsedRealtime()
        audioRouter.start()
        registerNetworkCallback()
        statsJob = scope.launch { statsLoop() }
        sendJoin()
    }

    private fun sendJoin() {
        val channel = channelId ?: return
        _status.value = "Connecting…"
        scope.launch {
            val ok = wsManager.sendSignaling("call_join", buildJsonObject { put("channel_id", channel) })
            if (!ok) { _status.value = "Not connected to the server."; return@launch }
            delay(CONNECT_TIMEOUT_MS)
            if (_inCall.value && _selfId.value == null && !rejoining) _status.value = "Couldn't connect to the call."
        }
    }

    fun toggleMute() {
        val muted = !_muted.value
        _muted.value = muted
        localAudio?.setEnabled(!muted)
        sendTrackState("audio", !muted, localAudio?.id())
        updateSelf { it.copy(audio = !muted) }
    }

    /** Silences (or restores) every incoming audio track, like the web client's deafen. */
    fun toggleDeafen() {
        val deaf = !_deafened.value
        _deafened.value = deaf
        remoteAudio.values.forEach { it.setEnabled(!deaf) }
    }

    fun toggleVideo() {
        val enable = !_videoOn.value
        _videoOn.value = enable
        if (enable) {
            if (localVideoTrack == null) { startCamera(); publishOffer() }
            else {
                val q = _cameraQuality.value
                runCatching { capturer?.startCapture(q.width, q.height, q.fps) }
                localVideoTrack?.setEnabled(true)
            }
        } else {
            localVideoTrack?.setEnabled(false)
            // Stop capturing so the camera light goes off; the track and its sender stay for a quick re-enable.
            runCatching { capturer?.stopCapture() }
        }
        sendTrackState("video", enable, localVideoTrack?.id())
        updateSelf { it.copy(video = enable) }
    }

    /** Switches between the front and back camera while capturing. */
    fun switchCamera() {
        val cap = capturer as? CameraVideoCapturer ?: return
        cap.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) { _frontCamera.value = isFront }
            override fun onCameraSwitchError(error: String?) { Log.w(tag, "camera switch failed: $error") }
        })
    }

    /**
     * Starts publishing the device screen. [permission] is the result data of the MediaProjection consent
     * activity; the call foreground service must already be running with the `mediaProjection` type.
     */
    fun startScreenShare(permission: Intent): Boolean {
        val pc = publishPc ?: return false
        val f = factory ?: return false
        if (screenTrack != null) return true
        return runCatching {
            val cap = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
                override fun onStop() { scope.launch { stopScreenShare() } }
            })
            val helper = SurfaceTextureHelper.create("ScreenCapture", eglBase.eglBaseContext)
            val source = f.createVideoSource(true)
            cap.initialize(helper, context, source.capturerObserver)
            val q = _screenQuality.value
            val (w, h) = screenSize(q)
            cap.startCapture(w, h, q.fps)
            val track = f.createVideoTrack("screen-${_selfId.value}", source)
            screenSender = pc.addTrack(track, listOf("screen"))
            screenCapturer = cap; screenHelper = helper; screenTrack = track
            _localScreen.value = track
            _screenSharing.value = true
            updateSelf { it.copy(screen = true) }
            sendTrackState("screen", true, track.id(), "screen")
            publishOffer()
            true
        }.getOrElse { Log.e(tag, "screen share failed", it); stopScreenShare(); false }
    }

    /** Stops publishing the screen and tells the room. */
    fun stopScreenShare(notify: Boolean = true) {
        val track = screenTrack
        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose(); screenCapturer = null
        screenHelper?.dispose(); screenHelper = null
        screenSender?.let { s -> runCatching { publishPc?.removeTrack(s) } }
        screenSender = null
        screenTrack = null
        _localScreen.value = null
        if (_screenSharing.value) {
            _screenSharing.value = false
            updateSelf { it.copy(screen = false) }
            if (notify) sendTrackState("screen", false, track?.id(), "screen")
            if (notify && publishPc != null) publishOffer()
        }
    }

    fun setCameraQuality(q: CameraQuality) {
        _cameraQuality.value = q
        runCatching { (capturer as? CameraVideoCapturer)?.changeCaptureFormat(q.width, q.height, q.fps) }
        applyEncodings()
    }

    fun setScreenQuality(q: ScreenQuality) {
        _screenQuality.value = q
        val (w, h) = screenSize(q)
        runCatching { screenCapturer?.changeCaptureFormat(w, h, q.fps) }
        applyEncodings()
    }

    fun setAdaptiveQuality(on: Boolean) {
        _adaptive.value = on
        if (!on) { adaptLevel = 0; _networkPoor.value = false; applyEncodings() }
    }

    fun setReceiveQuality(q: ReceiveQuality) { _receiveQuality.value = q }

    /** Asks the SFU for a fresh keyframe from [userId] (every publisher when null); same message the web client sends. */
    fun requestKeyframe(userId: String?) {
        val ch = channelId ?: return
        scope.launch {
            wsManager.sendSignaling("call_request_keyframe", buildJsonObject {
                put("channel_id", ch)
                if (userId != null) put("user_id", userId)
            })
        }
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
                    offering = false
                    applyEncodings()
                    if (renegotiationPending) { renegotiationPending = false; publishOffer() }
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
                _remoteScreens.update { it - id }
            }
            "call_track_state" -> {
                val uid = str(p, "user_id") ?: return
                val kind = str(p, "kind") ?: return
                val on = (p["enabled"] as? JsonPrimitive)?.booleanOrNull ?: return
                if (uid == _selfId.value) return
                _participants.update { list ->
                    list.map { if (it.userId == uid) when (kind) { "audio" -> it.copy(audio = on); "video" -> it.copy(video = on); "screen" -> it.copy(screen = on); else -> it } else it }
                }
                if (kind == "screen") {
                    if (on) { requestKeyframe(uid); scope.launch { delay(300); requestKeyframe(uid) } }
                    else _remoteScreens.update { it - uid }
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
        return CallParticipant(id, str(o, "username") ?: "User", flag("audio", true), flag("video", false), flag("screen", false))
    }

    private suspend fun onJoined(p: JsonObject) {
        _selfId.value = str(p, "self_id")
        val roster = (p["participants"] as? JsonArray)?.mapNotNull { parseParticipant(it as? JsonObject) }.orEmpty()
        val me = CoveApp.instance.preferencesManager
        val first = localAudio == null
        if (first) _muted.value = me.joinCallsMuted
        val self = CallParticipant(str(p, "self_id") ?: me.userId.orEmpty(), me.username ?: "me", audio = !_muted.value, video = _videoOn.value, screen = _screenSharing.value)
        _participants.value = roster.filter { it.userId != self.userId } + self

        val ice = (p["ice_servers"] as? JsonArray)?.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val urls = (o["urls"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: return@mapNotNull null
            PeerConnection.IceServer.builder(urls).apply {
                str(o, "username")?.let { setUsername(it) }
                str(o, "credential")?.let { setPassword(it) }
            }.createIceServer()
        }.orEmpty()
        val config = PeerConnection.RTCConfiguration(ice).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val f = factory ?: return

        publishRemoteSet = false
        subscribeRemoteSet = false
        offering = false
        renegotiationPending = false
        publishPc = f.createPeerConnection(config, object : SimplePeerConnectionObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) { candidate?.let { sendCandidate(it, "publish") } }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) { onPcState("publish", state) }
        })
        subscribePc = f.createPeerConnection(config, object : SimplePeerConnectionObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) { candidate?.let { sendCandidate(it, "subscribe") } }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) { onPcState("subscribe", state) }
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {
                receiver?.let { onRemoteTrack(it, mediaStreams?.firstOrNull()?.id.orEmpty()) }
            }
        })

        // Local microphone (echo/noise preferences come from Settings > Voice & Video)
        if (localAudio == null) {
            val constraints = MediaConstraints().apply {
                mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", me.echoCancellation.toString()))
                mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", me.noiseSuppression.toString()))
            }
            localAudio = f.createAudioTrack("audio-${self.userId}", f.createAudioSource(constraints))
        }
        localAudio?.setEnabled(!_muted.value)
        publishPc?.addTrack(localAudio, listOf(self.userId))
        if (_videoOn.value) {
            if (localVideoTrack == null) startCamera()
            else {
                cameraSender = publishPc?.addTrack(localVideoTrack, listOf(self.userId))
                val q = _cameraQuality.value
                runCatching { capturer?.startCapture(q.width, q.height, q.fps) }
            }
        }
        // A screen share that survived a reconnect keeps its capturer; just republish it.
        screenTrack?.let { screenSender = publishPc?.addTrack(it, listOf("screen")) }
        publishOffer()
        if (_muted.value) sendTrackState("audio", false, localAudio?.id())
        if (screenTrack != null) sendTrackState("screen", true, screenTrack?.id(), "screen")

        pendingSubscribeOffer?.let { pendingSubscribeOffer = null; answerSubscribeOffer(it) }
    }

    private fun onPcState(which: String, state: PeerConnection.PeerConnectionState?) {
        Log.d(tag, "$which connection: $state")
        scope.launch {
            when (state) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    failJob?.cancel()
                    if (which == "publish") _status.value = "Connected"
                }
                PeerConnection.PeerConnectionState.DISCONNECTED, PeerConnection.PeerConnectionState.FAILED -> {
                    if (_inCall.value && !rejoining) {
                        _status.value = "Reconnecting…"
                        failJob?.cancel()
                        // Brief blips heal by themselves (DISCONNECTED); FAILED never does.
                        failJob = launch { delay(if (state == PeerConnection.PeerConnectionState.FAILED) 1_000 else 7_000); rejoin("$which $state") }
                    }
                }
                else -> Unit
            }
        }
    }

    private fun onRemoteTrack(receiver: RtpReceiver, streamId: String) {
        val track = receiver.track() ?: return
        Log.d(tag, "remote track kind=${track.kind()} stream=$streamId")
        val isScreen = streamId.endsWith(":screen") || streamId == "screen"
        val owner = streamId.removeSuffix(":screen")
        when {
            track is VideoTrack && isScreen -> {
                val publisher = owner.takeIf { it.isNotEmpty() && it != "screen" } ?: _participants.value.firstOrNull { it.screen && it.userId != _selfId.value }?.userId ?: return
                videoTrackOwner[track.id()] = publisher
                _remoteScreens.update { it + (publisher to track) }
                updateParticipant(publisher) { it.copy(screen = true) }
                requestKeyframe(publisher)
                scope.launch { delay(300); requestKeyframe(publisher) }
            }
            track is VideoTrack -> {
                videoTrackOwner[track.id()] = owner
                _remoteVideo.update { it + (owner to track) }
                requestKeyframe(owner)
                scope.launch { delay(300); requestKeyframe(owner) }
            }
            track is AudioTrack -> {
                audioTrackOwner[track.id()] = owner
                remoteAudio[track.id()] = track
                track.setEnabled(!_deafened.value)
            }
        }
    }

    /**
     * Sends a fresh publish offer. Offers go out strictly one at a time: while one waits for its answer the
     * request is remembered and replayed from `call_publish_answer`, otherwise two quick toggles (camera then
     * screen) race and the second `setLocalDescription` clobbers the first (same rule as the web client).
     */
    private fun publishOffer() {
        val pc = publishPc ?: return
        val ch = channelId ?: return
        if (offering || pc.signalingState() != PeerConnection.SignalingState.STABLE) { renegotiationPending = true; return }
        offering = true
        scope.launch {
            runCatching {
                val offer = pc.createOffer(MediaConstraints())
                pc.setLocal(offer)
                wsManager.sendSignaling("call_publish_offer", buildJsonObject {
                    put("channel_id", ch)
                    put("sdp", buildJsonObject { put("type", "offer"); put("sdp", offer.description) })
                })
            }.onFailure { offering = false; Log.e(tag, "publish offer failed", it); _status.value = "Couldn't start the call." }
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

    private fun sendTrackState(kind: String, enabled: Boolean, trackId: String?, streamId: String? = null) {
        val ch = channelId ?: return
        scope.launch {
            wsManager.sendSignaling("call_track_state", buildJsonObject {
                put("channel_id", ch); put("kind", kind); put("enabled", enabled)
                trackId?.let { put("track_id", it) }
                (streamId ?: _selfId.value)?.let { put("stream_id", it) }
            })
        }
    }

    private fun updateSelf(change: (CallParticipant) -> CallParticipant) {
        val me = _selfId.value ?: return
        updateParticipant(me, change)
    }

    private fun updateParticipant(id: String, change: (CallParticipant) -> CallParticipant) {
        _participants.update { list -> list.map { if (it.userId == id) change(it) else it } }
    }

    // ── Capture ───────────────────────────────────────────────────────────────

    private fun startCamera() {
        val f = factory ?: return
        val enumerator = Camera2Enumerator(context)
        val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: enumerator.deviceNames.firstOrNull() ?: return
        val cap = enumerator.createCapturer(name, null) ?: return
        _frontCamera.value = enumerator.isFrontFacing(name)
        textureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        val source = f.createVideoSource(cap.isScreencast)
        cap.initialize(textureHelper, context, source.capturerObserver)
        val q = _cameraQuality.value
        cap.startCapture(q.width, q.height, q.fps)
        capturer = cap
        val track = f.createVideoTrack("video-${_selfId.value}", source)
        localVideoTrack = track
        cameraSender = publishPc?.addTrack(track, listOf(_selfId.value ?: "self"))
        _localVideo.value = track
    }

    /** Capture size for [q]: the display scaled so its longer edge fits `longSide`, rounded to even numbers. */
    private fun screenSize(q: ScreenQuality): Pair<Int, Int> {
        val m = context.resources.displayMetrics
        val long = maxOf(m.widthPixels, m.heightPixels).toFloat()
        val scale = minOf(1f, q.longSide / long)
        return ((m.widthPixels * scale).toInt() and 1.inv()) to ((m.heightPixels * scale).toInt() and 1.inv())
    }

    // ── Adaptive quality and health monitoring ────────────────────────────────

    private val bitrateFactor = doubleArrayOf(1.0, 0.6, 0.35, 0.2)
    private val fpsFactor = doubleArrayOf(1.0, 0.8, 0.6, 0.5)
    private val scaleDown = doubleArrayOf(1.0, 1.0, 1.5, 2.0)

    /** Applies the chosen presets, degraded by the current adaptation level, to the video senders. */
    private fun applyEncodings() {
        val cam = _cameraQuality.value
        val scr = _screenQuality.value
        cameraSender?.let { setEncoding(it, cam.maxBitrate, cam.fps, scaleDown[adaptLevel], false) }
        screenSender?.let { setEncoding(it, scr.maxBitrate, scr.fps, 1.0, true) }
    }

    private fun setEncoding(sender: RtpSender, bitrate: Int, fps: Int, scale: Double, isScreen: Boolean) {
        runCatching {
            val params = sender.parameters
            params.encodings.forEach { e ->
                e.maxBitrateBps = (bitrate * bitrateFactor[adaptLevel]).toInt()
                e.maxFramerate = maxOf(5, (fps * fpsFactor[adaptLevel]).toInt())
                if (!isScreen) e.scaleResolutionDownBy = scale
            }
            // Text and UI stay readable when the network struggles: drop frames before dropping resolution.
            if (isScreen) params.degradationPreference = org.webrtc.RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
            sender.setParameters(params)
        }
    }

    /**
     * Every 400 ms: speaking indicator from audio levels. Every 2 s: adaptive degradation from the outgoing
     * quality-limitation reason / RTT, and keyframe re-requests for remote videos whose decoded frame count stalled.
     */
    private suspend fun statsLoop() {
        var tick = 0
        while (_inCall.value) {
            delay(400)
            tick++
            val pub = publishPc?.stats()
            val sub = subscribePc?.stats()
            val now = HashSet<String>()
            pub?.statsMap?.values?.forEach { s ->
                if (s.type == "media-source" && s.members["kind"] == "audio") {
                    val level = (s.members["audioLevel"] as? Number)?.toDouble() ?: 0.0
                    _selfId.value?.let { me -> if (level > SPEAKING_LEVEL && !_muted.value) now.add(me) }
                }
            }
            sub?.statsMap?.values?.forEach { s ->
                if (s.type == "inbound-rtp" && s.members["kind"] == "audio") {
                    val level = (s.members["audioLevel"] as? Number)?.toDouble() ?: 0.0
                    val owner = audioTrackOwner[s.members["trackIdentifier"] as? String]
                    if (owner != null && level > SPEAKING_LEVEL && !_deafened.value) now.add(owner)
                }
            }
            for (u in now) speakingHang[u] = 2
            val it = speakingHang.entries.iterator()
            val shown = HashSet<String>()
            while (it.hasNext()) {
                val e = it.next()
                if (e.key in now) { shown.add(e.key); continue }
                if (e.value <= 1) it.remove() else { e.setValue(e.value - 1); shown.add(e.key) }
            }
            if (shown != _speaking.value) _speaking.value = shown

            if (tick % 5 != 0) continue
            if (_adaptive.value && pub != null) adapt(pub)
            if (sub != null) recoverStalledVideo(sub)
        }
    }

    private fun adapt(report: RTCStatsReport) {
        var limited = false
        var rtt = 0.0
        report.statsMap.values.forEach { s ->
            if (s.type == "outbound-rtp" && s.members["kind"] == "video") {
                val reason = s.members["qualityLimitationReason"] as? String
                if (reason == "bandwidth") limited = true
            }
            if (s.type == "candidate-pair" && s.members["state"] == "succeeded" && s.members["nominated"] == true) {
                rtt = (s.members["currentRoundTripTime"] as? Number)?.toDouble() ?: rtt
            }
        }
        if (rtt > 0.6) limited = true
        if (limited && adaptLevel < 3) {
            adaptLevel++; calmSamples = 0
            applyEncodings()
        } else if (!limited && adaptLevel > 0) {
            if (++calmSamples >= 5) { adaptLevel--; calmSamples = 0; applyEncodings() }
        }
        _networkPoor.value = adaptLevel > 0
    }

    private fun recoverStalledVideo(report: RTCStatsReport) {
        val nowMs = SystemClock.elapsedRealtime()
        report.statsMap.values.forEach { s ->
            if (s.type != "inbound-rtp" || s.members["kind"] != "video") return@forEach
            val key = s.members["trackIdentifier"] as? String ?: return@forEach
            val owner = videoTrackOwner[key] ?: return@forEach
            val frames = (s.members["framesDecoded"] as? Number)?.toLong() ?: return@forEach
            val prev = lastFrames.put(key, frames)
            val stalled = prev != null && frames == prev
            val shared = _participants.value.firstOrNull { it.userId == owner }?.let { it.video || it.screen } ?: false
            if (stalled && shared && nowMs - (lastKeyframeAt[owner] ?: 0L) > 4_000) {
                lastKeyframeAt[owner] = nowMs
                requestKeyframe(owner)
            }
        }
    }

    // ── Reconnect ─────────────────────────────────────────────────────────────

    private fun registerNetworkCallback() {
        if (netCallback != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val changed = networkLost || (lastNetwork != null && lastNetwork != network)
                lastNetwork = network
                networkLost = false
                if (changed && _inCall.value) scope.launch {
                    // Wi-Fi <-> cellular hand-over invalidates both ICE paths; give them a moment, then rejoin if they did not recover.
                    delay(3_000)
                    if (_inCall.value && !pcsHealthy()) rejoin("network changed")
                }
            }
            override fun onLost(network: Network) { if (network == lastNetwork) { lastNetwork = null; networkLost = true } }
        }
        netCallback = cb
        runCatching { cm.registerDefaultNetworkCallback(cb) }
    }

    private fun pcsHealthy(): Boolean {
        val pub = publishPc?.connectionState()
        val sub = subscribePc?.connectionState()
        return pub == PeerConnection.PeerConnectionState.CONNECTED &&
            sub != PeerConnection.PeerConnectionState.FAILED && sub != PeerConnection.PeerConnectionState.DISCONNECTED
    }

    /**
     * Leaves and re-joins the room on a fresh pair of PeerConnections, keeping mic, camera and (running) screen
     * capture alive so the user's mute / camera state survives a network hand-over or server restart.
     */
    private fun rejoin(reason: String) {
        if (!_inCall.value || rejoining) return
        Log.d(tag, "rejoin: $reason")
        rejoining = true
        failJob?.cancel()
        scope.launch {
            _status.value = "Reconnecting…"
            channelId?.let { id -> wsManager.sendSignaling("call_leave", buildJsonObject { put("channel_id", id) }) }
            closePeerConnections()
            withTimeoutOrNull(15_000) { wsManager.connectionState.first { it } }
            delay(500)
            rejoining = false
            if (_inCall.value) sendJoin()
        }
    }

    private fun closePeerConnections() {
        publishPc?.dispose(); subscribePc?.dispose()
        publishPc = null; subscribePc = null
        cameraSender = null; screenSender = null
        pendingSubscribeOffer = null
        pendingPublishIce.clear(); pendingSubscribeIce.clear()
        publishRemoteSet = false; subscribeRemoteSet = false
        offering = false; renegotiationPending = false
        remoteAudio.clear(); audioTrackOwner.clear(); videoTrackOwner.clear(); lastFrames.clear()
        _remoteVideo.value = emptyMap(); _remoteScreens.value = emptyMap()
        _selfId.value = null
    }

    private fun cleanup() {
        statsJob?.cancel(); statsJob = null
        failJob?.cancel(); failJob = null
        netCallback?.let { cb -> runCatching { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb) } }
        netCallback = null; lastNetwork = null; networkLost = false
        stopScreenShare(notify = false)
        runCatching { capturer?.stopCapture() }
        capturer?.dispose(); capturer = null
        textureHelper?.dispose(); textureHelper = null
        closePeerConnections()
        localAudio = null; localVideoTrack = null
        audioRouter.stop()
        _inCall.value = false; _muted.value = false; _deafened.value = false; _videoOn.value = false; _frontCamera.value = true
        _screenSharing.value = false; _networkPoor.value = false; _speaking.value = emptySet(); speakingHang.clear()
        _participants.value = emptyList(); _localVideo.value = null; _localScreen.value = null
        _status.value = ""
        rejoining = false; wsWasDown = false
        channelId = null
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 12_000L
        const val SPEAKING_LEVEL = 0.02
    }
}

private suspend fun PeerConnection.stats(): RTCStatsReport = suspendCancellableCoroutine { k -> getStats { k.resume(it) } }

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
