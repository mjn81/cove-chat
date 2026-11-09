package com.cove.chat.rtc.udp

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.net.ConnectivityManager
import android.net.Network
import android.os.SystemClock
import android.util.Log
import com.cove.chat.data.local.PreferencesManager
import com.cove.chat.data.model.ServerVersion
import com.cove.chat.data.remote.WebSocketManager
import com.cove.chat.data.udpmedia.ClientJoin
import com.cove.chat.data.udpmedia.Codec
import com.cove.chat.data.udpmedia.Flags
import com.cove.chat.data.udpmedia.Kind
import com.cove.chat.data.udpmedia.ReceivedFrame
import com.cove.chat.data.udpmedia.UdpMediaClient
import com.cove.chat.rtc.CallAudioRouter
import com.cove.chat.rtc.CallEngine
import com.cove.chat.rtc.CallParticipant
import com.cove.chat.rtc.CameraQuality
import com.cove.chat.rtc.ReceiveQuality
import com.cove.chat.rtc.ScreenQuality
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * The call engine for servers in `voice.mode = "raw_udp"` (air-gapped LANs): same behaviour and same UI as the WebRTC
 * engine, but media travels over the encrypted UDP protocol of docs/udp-media.md. Signalling is the authenticated
 * WebSocket (`call_join` with an X25519 `media` block, `call_joined`, roster and track-state events); audio is Opus,
 * camera and screen are H.264, all handled by the pieces in this package. Mirrors `client-web/src/rtc/UdpMediaManager.ts`.
 *
 * Everything the screens observe is a StateFlow updated from the main thread; media runs on its own threads.
 */
class UdpCallManager(
    private val context: Context,
    private val wsManager: WebSocketManager,
    private val prefs: PreferencesManager,
    override val eglBase: EglBase,
    override val audioRouter: CallAudioRouter,
    private val serverInfo: () -> ServerVersion?,
) : CallEngine {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val tag = "UdpCall"

    private var channelId: String? = null
    private val directory = MediaDirectory()
    private var pendingJoin: ClientJoin? = null
    private var session: Session? = null
    private var rejoining = false
    private var wsWasDown = false
    private var errorRejoins = 0
    private var joinedOnce = false
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var loopJob: Job? = null

    // Media pieces. The factory is only used to mint VideoSources/Tracks; there are no peer connections in this path.
    private val pcf: PeerConnectionFactory by lazy { PeerConnectionFactory.builder().createPeerConnectionFactory() }
    private var audio: UdpAudioEngine? = null
    private var camera: LocalVideo? = null
    private var screen: LocalVideo? = null
    private val receivers = HashMap<Pair<String, Kind>, H264Subscriber>()
    private val backoff = BackoffController()
    private val speakingTracker = SpeakingTracker()
    private var lastKeyReqCount = 0

    private val _inCall = MutableStateFlow(false)
    override val isInCall: StateFlow<Boolean> = _inCall.asStateFlow()
    private val _muted = MutableStateFlow(false)
    override val isMuted: StateFlow<Boolean> = _muted.asStateFlow()
    private val _deafened = MutableStateFlow(false)
    override val isDeafened: StateFlow<Boolean> = _deafened.asStateFlow()
    private val _videoOn = MutableStateFlow(false)
    override val isVideoEnabled: StateFlow<Boolean> = _videoOn.asStateFlow()
    private val _frontCamera = MutableStateFlow(true)
    override val isFrontCamera: StateFlow<Boolean> = _frontCamera.asStateFlow()
    private val _screenSharing = MutableStateFlow(false)
    override val isScreenSharing: StateFlow<Boolean> = _screenSharing.asStateFlow()
    private val _selfId = MutableStateFlow<String?>(null)
    override val selfId: StateFlow<String?> = _selfId.asStateFlow()
    private val _participants = MutableStateFlow<List<CallParticipant>>(emptyList())
    override val participants: StateFlow<List<CallParticipant>> = _participants.asStateFlow()
    private val _remoteVideo = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    override val remoteVideo: StateFlow<Map<String, VideoTrack>> = _remoteVideo.asStateFlow()
    private val _remoteScreens = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    override val remoteScreens: StateFlow<Map<String, VideoTrack>> = _remoteScreens.asStateFlow()
    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    override val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()
    private val _localScreen = MutableStateFlow<VideoTrack?>(null)
    override val localScreen: StateFlow<VideoTrack?> = _localScreen.asStateFlow()
    private val _speaking = MutableStateFlow<Set<String>>(emptySet())
    override val speaking: StateFlow<Set<String>> = _speaking.asStateFlow()
    private val _status = MutableStateFlow("")
    override val status: StateFlow<String> = _status.asStateFlow()
    private val _cameraQuality = MutableStateFlow(CameraQuality.Medium)
    override val cameraQuality: StateFlow<CameraQuality> = _cameraQuality.asStateFlow()
    private val _screenQuality = MutableStateFlow(ScreenQuality.Balanced)
    override val screenQuality: StateFlow<ScreenQuality> = _screenQuality.asStateFlow()
    private val _adaptive = MutableStateFlow(true)
    override val adaptiveQuality: StateFlow<Boolean> = _adaptive.asStateFlow()
    private val _networkPoor = MutableStateFlow(false)
    override val networkPoor: StateFlow<Boolean> = _networkPoor.asStateFlow()
    private val _receiveQuality = MutableStateFlow(ReceiveQuality.Full)
    override val receiveQuality: StateFlow<ReceiveQuality> = _receiveQuality.asStateFlow()

    override var callStartedAt = 0L
        private set

    /** One capture source plus its encoder. */
    private class LocalVideo(
        val capturer: VideoCapturer,
        val helper: SurfaceTextureHelper,
        val source: VideoSource,
        val track: VideoTrack,
        val publisher: H264Publisher,
    )

    /** Everything tied to one `call_joined`: the socket client, its coroutines and the keyring owner. */
    private class Session(val client: UdpMediaClient, val scope: CoroutineScope)

    init {
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

    override fun joinCall(channel: String, enableVideo: Boolean) {
        if (_inCall.value) return
        channelId = channel
        _inCall.value = true
        _videoOn.value = enableVideo
        _deafened.value = false
        errorRejoins = 0
        joinedOnce = false
        backoff.reset()
        callStartedAt = SystemClock.elapsedRealtime()
        audioRouter.start()
        registerNetworkCallback()
        loopJob = scope.launch { statusLoop() }
        sendJoin()
    }

    private fun sendJoin() {
        val channel = channelId ?: return
        _status.value = "Connecting…"
        val join = ClientJoin.create()
        pendingJoin = join
        scope.launch {
            val ok = wsManager.sendSignaling("call_join", UdpSignals.joinPayload(channel, join.clientPub, join.clientNonce))
            if (!ok) { _status.value = "Not connected to the server."; return@launch }
            delay(CONNECT_TIMEOUT_MS)
            if (_inCall.value && _selfId.value == null && !rejoining) _status.value = "Couldn't connect to the call."
        }
    }

    override fun toggleMute() {
        val muted = !_muted.value
        _muted.value = muted
        audio?.muted = muted
        sendTrackState("audio", !muted)
        updateSelf { it.copy(audio = !muted) }
    }

    override fun toggleDeafen() {
        val deaf = !_deafened.value
        _deafened.value = deaf
        audio?.deafened = deaf
    }

    override fun toggleVideo() {
        val enable = !_videoOn.value
        _videoOn.value = enable
        if (enable) {
            if (!startCamera()) { _videoOn.value = false; _status.value = "Couldn't start the camera."; return }
        } else {
            stopCamera()
        }
        sendTrackState("video", _videoOn.value)
        updateSelf { it.copy(video = _videoOn.value) }
    }

    override fun switchCamera() {
        val cap = camera?.capturer as? CameraVideoCapturer ?: return
        cap.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) { _frontCamera.value = isFront }
            override fun onCameraSwitchError(error: String?) { Log.w(tag, "camera switch failed: $error") }
        })
    }

    override fun startScreenShare(permission: Intent): Boolean {
        if (screen != null) return true
        if (session == null) return false // nothing to publish to yet
        return runCatching {
            val cap = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
                override fun onStop() { scope.launch { stopScreenShare() } }
            })
            val q = _screenQuality.value
            val (w, h) = screenSize(q)
            val local = startLocal(cap, true, Kind.SCREEN, "screen", w, h, q.fps, screenBitrate(q))
            screen = local
            _localScreen.value = local.track
            _screenSharing.value = true
            updateSelf { it.copy(screen = true) }
            sendTrackState("screen", true)
            true
        }.getOrElse { Log.e(tag, "screen share failed", it); stopScreenShare(notify = false); false }
    }

    override fun stopScreenShare(notify: Boolean) {
        val had = screen != null
        screen?.let { disposeLocal(it) }
        screen = null
        _localScreen.value = null
        if (_screenSharing.value || had) {
            _screenSharing.value = false
            updateSelf { it.copy(screen = false) }
            if (notify) sendTrackState("screen", false)
        }
    }

    override fun setCameraQuality(q: CameraQuality) {
        _cameraQuality.value = q
        camera?.let {
            runCatching { (it.capturer as? CameraVideoCapturer)?.changeCaptureFormat(q.width, q.height, q.fps) }
            applyEncodings()
        }
    }

    override fun setScreenQuality(q: ScreenQuality) {
        _screenQuality.value = q
        screen?.let {
            val (w, h) = screenSize(q)
            runCatching { it.capturer.changeCaptureFormat(w, h, q.fps) }
            applyEncodings()
        }
    }

    override fun setAdaptiveQuality(on: Boolean) {
        _adaptive.value = on
        if (!on) { backoff.reset(); _networkPoor.value = false; applyEncodings() }
    }

    override fun setReceiveQuality(q: ReceiveQuality) {
        val was = _receiveQuality.value
        _receiveQuality.value = q
        // A paused screen stopped decoding; resuming needs a fresh reference frame.
        if (was == ReceiveQuality.Paused && q != ReceiveQuality.Paused) requestKeyframe(null)
    }

    override fun requestKeyframe(userId: String?) {
        val s = session ?: return
        val targets = if (userId != null) listOfNotNull(userId) else _participants.value.map { it.userId }.filter { it != _selfId.value }
        for (u in targets) {
            val media = directory.mediaOf(u) ?: continue
            s.client.requestKeyframe(media, Kind.VIDEO)
            s.client.requestKeyframe(media, Kind.SCREEN)
        }
    }

    override fun leaveCall() {
        channelId?.let { id -> scope.launch { wsManager.sendSignaling("call_leave", buildJsonObject { put("channel_id", id) }) } }
        cleanup()
    }

    // ── Signalling ────────────────────────────────────────────────────────────

    private suspend fun onSignal(type: String, p: JsonObject) {
        // The WebRTC engine hears the same events; ignore everything while no call of ours is running.
        if (!_inCall.value) return
        when (type) {
            "call_joined" -> onJoined(p)
            "call_participant_joined" -> {
                val (ch, user) = UdpSignals.participantEvent(p)
                if (ch != null && ch != channelId) return
                user ?: return
                user.mediaId?.let { directory.put(it, user.userId) }
                val np = CallParticipant(user.userId, user.username, user.audio, user.video, user.screen)
                _participants.update { list -> list.filterNot { it.userId == np.userId } + np }
            }
            "call_participant_left" -> {
                val (ch, user) = UdpSignals.participantEvent(p)
                if (ch != null && ch != channelId) return
                user ?: return
                removeRemote(user.userId)
                _participants.update { list -> list.filterNot { it.userId == user.userId } }
            }
            "call_track_state" -> {
                val (uid, kind, on) = UdpSignals.trackState(p) ?: return
                if (uid == _selfId.value) return
                _participants.update { list ->
                    list.map { if (it.userId == uid) when (kind) { "audio" -> it.copy(audio = on); "video" -> it.copy(video = on); "screen" -> it.copy(screen = on); else -> it } else it }
                }
                val k = when (kind) { "video" -> Kind.VIDEO; "screen" -> Kind.SCREEN; else -> null } ?: return
                if (on) {
                    // A new viewer needs a reference frame; ask twice because the first may race the encoder start.
                    requestKeyframe(uid)
                    scope.launch { delay(300); requestKeyframe(uid) }
                } else dropReceiver(uid, k)
            }
            // The server closed our media session (timeout, kick, removal) or refused the join.
            "call_error" -> onServerError(UdpSignals.errorText(p) ?: "Call error", p, ended = false)
            "call_ended" -> onServerError(UdpSignals.errorText(p) ?: "The call ended.", p, ended = true)
        }
    }

    private fun onServerError(text: String, p: JsonObject, ended: Boolean) {
        val ch = (p["channel_id"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        if (ch != null && ch != channelId) return
        if (!_inCall.value) return
        Log.d(tag, "server ${if (ended) "ended" else "error"}: $text")
        if (ended) { cleanup(); return }
        _status.value = text
        // Before we ever joined, the message is the answer (full, not a member): stay on the screen so it is read.
        if (!joinedOnce) return
        // A lost media session can simply be re-established (docs/udp-media.md section 6), a few times.
        if (errorRejoins++ < MAX_ERROR_REJOINS) rejoin("server error") else cleanup()
    }

    private fun onJoined(p: JsonObject) {
        val j = UdpSignals.joined(p)
        if (j == null) { _status.value = "Couldn't start the call."; return }
        if (j.channelId != channelId) return
        val join = pendingJoin ?: return
        pendingJoin = null
        rejoining = false
        closeSession()
        stopRemoteMedia()

        _selfId.value = j.selfId
        directory.clear()
        directory.put(j.media.mediaId, j.selfId)
        j.participants.forEach { u -> u.mediaId?.let { directory.put(it, u.userId) } }
        val first = !joinedOnce
        if (first) _muted.value = prefs.joinCallsMuted
        val self = CallParticipant(j.selfId, prefs.username ?: "me", audio = !_muted.value, video = _videoOn.value, screen = _screenSharing.value)
        _participants.value = j.participants.filter { it.userId != j.selfId }.map { CallParticipant(it.userId, it.username, it.audio, it.video, it.screen) } + self

        val ring = try {
            join.complete(j.media, j.channelId, j.selfId, SystemClock::elapsedRealtime)
        } catch (e: Exception) {
            Log.w(tag, "key agreement failed: ${e.javaClass.simpleName}")
            _status.value = "Couldn't start the call."
            return
        }
        val endpoint = serverInfo()?.let { UdpSignals.mediaEndpoint(prefs.serverUrl, it.udpPort) } ?: UdpSignals.mediaEndpoint(prefs.serverUrl, DEFAULT_UDP_PORT)
        if (endpoint == null) { _status.value = "Couldn't start the call."; return }

        val sessionScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        scope.launch {
            val addr = withContext(Dispatchers.IO) { runCatching { UdpMediaClient.resolve(endpoint.first, endpoint.second) }.getOrNull() }
            if (addr == null || !_inCall.value) { sessionScope.cancel(); if (addr == null) _status.value = "Couldn't connect to the call."; return@launch }
            val client = UdpMediaClient(addr, ring, sessionScope, SystemClock::elapsedRealtime)
            client.start()
            val ok = try { client.handshake(HANDSHAKE_TIMEOUT_MS); true } catch (_: TimeoutCancellationException) { false }
            if (!ok || !_inCall.value || channelId != j.channelId) {
                client.close(); sessionScope.cancel()
                if (!ok && _inCall.value) _status.value = "Couldn't connect to the call."
                return@launch
            }
            session = Session(client, sessionScope)
            joinedOnce = true
            lastKeyReqCount = 0
            _status.value = "Connected"
            startMedia(client, sessionScope)
            // Announce our state so others show the right icons, and resume anything that survived a rejoin.
            sendTrackState("audio", !_muted.value)
            if (_screenSharing.value) sendTrackState("screen", true)
            if (_videoOn.value && camera == null && !startCamera()) { _videoOn.value = false; updateSelf { it.copy(video = false) } }
            if (_videoOn.value) sendTrackState("video", true)
            camera?.publisher?.requestKeyframe()
            screen?.publisher?.requestKeyframe()
            requestKeyframe(null)
        }
    }

    // ── Media session ─────────────────────────────────────────────────────────

    private fun startMedia(client: UdpMediaClient, sessionScope: CoroutineScope) {
        val engine = UdpAudioEngine { data, ts -> client.sendFrame(Kind.AUDIO, Codec.OPUS, 0, ts, data) }
        engine.muted = _muted.value
        engine.deafened = _deafened.value
        engine.start(prefs.echoCancellation, prefs.noiseSuppression)
        audio = engine
        if (engine.micFailed) { /* checked asynchronously in statusLoop */ }

        sessionScope.launch {
            for (rf in client.frames) {
                // Audio goes straight to the jitter buffer from this thread; video touches UI state, so it hops to Main.
                if (rf.frame.kind == Kind.AUDIO) onAudioFrame(rf) else withContext(Dispatchers.Main) { onVideoFrame(rf) }
            }
        }
        sessionScope.launch {
            for (kind in client.keyframeRequests) {
                when (kind) {
                    Kind.VIDEO -> camera?.publisher?.requestKeyframe()
                    Kind.SCREEN -> screen?.publisher?.requestKeyframe()
                    Kind.AUDIO -> Unit
                }
            }
        }
    }

    /** Hands an Opus frame to the playout engine. Runs on the network thread; everything it touches is thread safe. */
    private fun onAudioFrame(rf: ReceivedFrame) {
        val user = directory.userOf(rf.src) ?: return // not announced yet; skipped until the roster catches up
        if (user == _selfId.value || rf.frame.codec != Codec.OPUS) return
        audio?.feed(user, rf.frame.id, rf.frame.data)
    }

    /** Routes a camera or screen frame to its decoder. Runs on the main thread. */
    private fun onVideoFrame(rf: ReceivedFrame) {
        val user = directory.userOf(rf.src) ?: return
        if (user == _selfId.value) return
        val f = rf.frame
        if (f.codec != Codec.H264) return // another codec: ignore the stream, as the protocol allows
        // Only decode what the sender announced: frames still in flight after `call_track_state enabled=false` must
        // not recreate a decoder and a tile that nothing would ever remove again.
        val announced = _participants.value.firstOrNull { it.userId == user }?.let { if (f.kind == Kind.SCREEN) it.screen else it.video } ?: false
        if (!announced) return
        if (f.kind == Kind.SCREEN && _receiveQuality.value == ReceiveQuality.Paused) return
        receiver(user, f.kind).decode(f.keyframe, f.ts, f.data)
    }

    private fun receiver(user: String, kind: Kind): H264Subscriber = receivers.getOrPut(user to kind) {
        val sub = H264Subscriber(pcf, eglBase, "$user-${kind.trackName}", kind == Kind.SCREEN) { requestKeyframeOf(user, kind) }
        if (kind == Kind.SCREEN) {
            _remoteScreens.update { it + (user to sub.track) }
            _participants.update { l -> l.map { if (it.userId == user) it.copy(screen = true) else it } }
        } else _remoteVideo.update { it + (user to sub.track) }
        sub
    }

    private fun requestKeyframeOf(user: String, kind: Kind) {
        val media = directory.mediaOf(user) ?: return
        session?.client?.requestKeyframe(media, kind)
    }

    private fun dropReceiver(user: String, kind: Kind) {
        receivers.remove(user to kind)?.dispose()
        if (kind == Kind.SCREEN) _remoteScreens.update { it - user } else _remoteVideo.update { it - user }
    }

    private fun removeRemote(user: String) {
        dropReceiver(user, Kind.VIDEO)
        dropReceiver(user, Kind.SCREEN)
        audio?.removeRemote(user)
        directory.remove(user)
    }

    private fun stopRemoteMedia() {
        receivers.keys.toList().forEach { dropReceiver(it.first, it.second) }
        audio?.clearRemotes()
    }

    /** Ends the UDP session (not the call): socket, audio engine and reassemblers. Local capture keeps running. */
    private fun closeSession() {
        val s = session
        session = null
        audio?.stop()
        audio = null
        s?.let { runCatching { it.client.close() }; it.scope.cancel() }
    }

    // ── Capture ───────────────────────────────────────────────────────────────

    private fun startCamera(): Boolean {
        if (camera != null) return true
        return runCatching {
            val enumerator = Camera2Enumerator(context)
            val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: enumerator.deviceNames.firstOrNull() ?: return false
            val cap = enumerator.createCapturer(name, null) ?: return false
            _frontCamera.value = enumerator.isFrontFacing(name)
            val q = _cameraQuality.value
            val local = startLocal(cap, false, Kind.VIDEO, "camera", q.width, q.height, q.fps, cameraBitrate(q))
            camera = local
            _localVideo.value = local.track
            true
        }.getOrElse { Log.e(tag, "camera failed", it); false }
    }

    private fun stopCamera() {
        camera?.let { disposeLocal(it) }
        camera = null
        _localVideo.value = null
    }

    /** Wires a capturer to a video source/track and an H.264 publisher feeding the UDP session. */
    private fun startLocal(cap: VideoCapturer, isScreen: Boolean, kind: Kind, label: String, w: Int, h: Int, fps: Int, bitrate: Int): LocalVideo {
        val helper = SurfaceTextureHelper.create("Udp-$label", eglBase.eglBaseContext)
        val source = pcf.createVideoSource(isScreen)
        cap.initialize(helper, context, source.capturerObserver)
        val publisher = H264Publisher(
            egl = eglBase, tag = label,
            send = { key, ts, data -> session?.client?.sendFrame(kind, Codec.H264, if (key) Flags.KEYFRAME else 0, ts, data) ?: true },
            onOversize = { scope.launch { forceBackoff() } },
            onError = { msg -> scope.launch { _status.value = msg } },
        )
        publisher.setRate(BackoffController.bitrateFor(bitrate, backoff.level), BackoffController.fpsFor(fps, backoff.level))
        val track = pcf.createVideoTrack("udp-$label-${_selfId.value}", source)
        track.addSink(publisher)
        cap.startCapture(w, h, fps)
        return LocalVideo(cap, helper, source, track, publisher)
    }

    private fun disposeLocal(l: LocalVideo) {
        runCatching { l.track.removeSink(l.publisher) }
        runCatching { l.capturer.stopCapture() }
        l.publisher.stop()
        runCatching { l.capturer.dispose() }
        runCatching { l.track.dispose() }
        runCatching { l.source.dispose() }
        runCatching { l.helper.dispose() }
    }

    private fun cameraBitrate(q: CameraQuality) = minOf(q.maxBitrate, CAMERA_BITRATE_CAP)
    private fun screenBitrate(q: ScreenQuality) = minOf(q.maxBitrate, SCREEN_BITRATE_CAP)

    /** Capture size for [q]: the display scaled so its longer edge fits `longSide`, rounded to even numbers. */
    private fun screenSize(q: ScreenQuality): Pair<Int, Int> {
        val m = context.resources.displayMetrics
        val long = maxOf(m.widthPixels, m.heightPixels).toFloat()
        val scale = minOf(1f, q.longSide / long)
        return ((m.widthPixels * scale).toInt() and 1.inv()) to ((m.heightPixels * scale).toInt() and 1.inv())
    }

    /** Applies the chosen presets, degraded by the current back-off level, to both encoders and capture pipelines. */
    private fun applyEncodings() {
        val lvl = backoff.level
        camera?.let {
            val q = _cameraQuality.value
            val scale = BackoffController.scaleFor(lvl)
            val fps = BackoffController.fpsFor(q.fps, lvl)
            it.publisher.setRate(BackoffController.bitrateFor(cameraBitrate(q), lvl), fps)
            runCatching { it.source.adaptOutputFormat((q.width / scale).toInt() and 1.inv(), (q.height / scale).toInt() and 1.inv(), fps) }
        }
        screen?.let {
            val q = _screenQuality.value
            // Text stays readable on a struggling network: frames are dropped before resolution is.
            it.publisher.setRate(BackoffController.bitrateFor(screenBitrate(q), lvl), BackoffController.fpsFor(q.fps, lvl))
        }
    }

    /** A frame did not fit the protocol's 64 fragments: lower the quality even if adaptive quality is off, or no keyframe would ever fit. */
    private fun forceBackoff() {
        backoff.sample(Int.MAX_VALUE)
        _networkPoor.value = backoff.level > 0
        applyEncodings()
    }

    // ── Health: speaking indicator, adaptive quality, microphone watchdog ─────

    private suspend fun statusLoop() {
        var tick = 0
        while (scope.isActive && _inCall.value) {
            delay(400)
            tick++
            val a = audio
            val me = _selfId.value
            val active = HashSet<String>()
            if (a != null) {
                if (me != null && !_muted.value && a.localLevel > SpeakingTracker.THRESHOLD) active.add(me)
                if (!_deafened.value) a.remoteLevels().forEach { (u, l) -> if (l > SpeakingTracker.THRESHOLD) active.add(u) }
                if (a.micFailed && !_muted.value) { _muted.value = true; a.muted = true; sendTrackState("audio", false); updateSelf { it.copy(audio = false) } }
            }
            val shown = speakingTracker.tick(active)
            if (shown != _speaking.value) _speaking.value = shown

            if (tick % 5 != 0 || !_adaptive.value) continue
            val client = session?.client ?: continue
            val now = client.keyframeRequestsReceived
            val signals = now - lastKeyReqCount
            lastKeyReqCount = now
            val before = backoff.level
            val after = backoff.sample(signals)
            _networkPoor.value = after > 0
            if (after != before) applyEncodings()
        }
    }

    // ── Reconnect ─────────────────────────────────────────────────────────────

    private fun registerNetworkCallback() {
        if (netCallback != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            // Wi-Fi <-> cellular: the session survives (the server follows an authenticated HELLO from a new address),
            // so announce the new path immediately instead of waiting for the next 5 s keepalive.
            override fun onAvailable(network: Network) { session?.client?.probe() }
        }
        netCallback = cb
        runCatching { cm.registerDefaultNetworkCallback(cb) }
    }

    private fun rejoin(reason: String) {
        if (!_inCall.value || rejoining) return
        Log.d(tag, "rejoin: $reason")
        rejoining = true
        scope.launch {
            _status.value = "Reconnecting…"
            channelId?.let { id -> wsManager.sendSignaling("call_leave", buildJsonObject { put("channel_id", id) }) }
            closeSession()
            stopRemoteMedia()
            _selfId.value = null
            withTimeoutOrNull(15_000) { wsManager.connectionState.first { it } }
            delay(500)
            if (_inCall.value) { rejoining = false; sendJoin() }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun sendTrackState(kind: String, enabled: Boolean) {
        val ch = channelId ?: return
        scope.launch {
            wsManager.sendSignaling("call_track_state", buildJsonObject {
                put("channel_id", ch); put("kind", kind); put("enabled", enabled)
            })
        }
    }

    private fun updateSelf(change: (CallParticipant) -> CallParticipant) {
        val me = _selfId.value ?: return
        _participants.update { list -> list.map { if (it.userId == me) change(it) else it } }
    }

    private fun cleanup() {
        loopJob?.cancel(); loopJob = null
        netCallback?.let { cb -> runCatching { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb) } }
        netCallback = null
        stopScreenShare(notify = false)
        stopCamera()
        stopRemoteMedia()
        closeSession()
        directory.clear()
        pendingJoin = null
        audioRouter.stop()
        _inCall.value = false; _muted.value = false; _deafened.value = false; _videoOn.value = false; _frontCamera.value = true
        _screenSharing.value = false; _networkPoor.value = false; _speaking.value = emptySet(); speakingTracker.clear()
        _participants.value = emptyList(); _localVideo.value = null; _localScreen.value = null
        _remoteVideo.value = emptyMap(); _remoteScreens.value = emptyMap()
        _selfId.value = null
        _status.value = ""
        rejoining = false; wsWasDown = false
        channelId = null
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 12_000L
        const val HANDSHAKE_TIMEOUT_MS = 10_000L
        const val DEFAULT_UDP_PORT = 9090
        const val MAX_ERROR_REJOINS = 3
        /** Suggested sender caps from docs/udp-media.md section 7. */
        const val CAMERA_BITRATE_CAP = 1_500_000
        const val SCREEN_BITRATE_CAP = 3_000_000
    }
}
