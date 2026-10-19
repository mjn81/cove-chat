package com.nodetalk.client.rtc

import android.content.Context
import com.nodetalk.client.data.model.CallAnswerPayload
import com.nodetalk.client.data.model.CallCandidatePayload
import com.nodetalk.client.data.model.CallJoinedPayload
import com.nodetalk.client.data.model.CallOfferPayload
import com.nodetalk.client.data.remote.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack

/**
 * WebRTC Client Manager implementing the dual PeerConnection model
 * (Publish Connection + Subscribe Connection) for NodeTalk's in-process SFU.
 * Matches client-web/src/rtc/WebRTCManager.ts.
 */
class WebRTCManager(
    private val context: Context,
    private val wsManager: WebSocketManager
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true }

    val eglBase: EglBase = EglBase.create()
    private var peerConnectionFactory: PeerConnectionFactory? = null

    private var publishPc: PeerConnection? = null
    private var subscribePc: PeerConnection? = null

    private var localAudioTrack: AudioTrack? = null
    private var localVideoTrack: VideoTrack? = null
    private var videoCapturer: VideoCapturer? = null

    private var currentChannelId: String? = null

    private val _isInCall = MutableStateFlow(false)
    val isInCall: StateFlow<Boolean> = _isInCall.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isVideoEnabled = MutableStateFlow(false)
    val isVideoEnabled: StateFlow<Boolean> = _isVideoEnabled.asStateFlow()

    private val _participants = MutableStateFlow<List<String>>(emptyList())
    val participants: StateFlow<List<String>> = _participants.asStateFlow()

    init {
        initializeFactory()
        observeSignaling()
    }

    private fun initializeFactory() {
        val initOptions = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(false)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(initOptions)

        val encoderFactory = DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(eglBase.eglBaseContext)

        peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()
    }

    private fun observeSignaling() {
        scope.launch {
            wsManager.signalingFlow.collect { (type, payload) ->
                when (type) {
                    "call_joined" -> {
                        val joined = json.decodeFromJsonElement<CallJoinedPayload>(payload)
                        setupPeerConnections(joined)
                    }
                    "call_answer" -> {
                        val answer = json.decodeFromJsonElement<CallAnswerPayload>(payload)
                        handlePublishAnswer(answer.sdp)
                    }
                    "call_offer" -> {
                        val offer = json.decodeFromJsonElement<CallOfferPayload>(payload)
                        handleSubscribeOffer(offer.sdp)
                    }
                    "call_candidate" -> {
                        val cand = json.decodeFromJsonElement<CallCandidatePayload>(payload)
                        handleRemoteCandidate(cand)
                    }
                    "call_user_joined" -> {
                        val userId = payload.toString() // simplify participant tracking
                        _participants.value = (_participants.value + userId).distinct()
                    }
                    "call_user_left" -> {
                        val userId = payload.toString()
                        _participants.value = _participants.value.filter { it != userId }
                    }
                }
            }
        }
    }

    fun joinCall(channelId: String, enableVideo: Boolean = false) {
        currentChannelId = channelId
        _isInCall.value = true
        _isVideoEnabled.value = enableVideo

        scope.launch {
            val joinPayload = buildJsonObject {
                put("channel_id", channelId)
                put("has_video", enableVideo)
            }
            wsManager.sendSignaling("call_join", joinPayload)
        }
    }

    private fun setupPeerConnections(payload: CallJoinedPayload) {
        val iceServers = payload.iceServers.flatMap { server ->
            server.urls.map { url ->
                PeerConnection.IceServer.builder(url).apply {
                    server.username?.let { setUsername(it) }
                    server.credential?.let { setPassword(it) }
                }.createIceServer()
            }
        }.ifEmpty {
            listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        }

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        // 1. Setup Publish Connection
        publishPc = peerConnectionFactory?.createPeerConnection(rtcConfig, object : SimplePeerConnectionObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate?.let { sendCandidate(it, target = "publish") }
            }
        })

        // Add Local Media Tracks
        val audioSource = peerConnectionFactory?.createAudioSource(MediaConstraints())
        localAudioTrack = peerConnectionFactory?.createAudioTrack("ARDAMSa0", audioSource)
        publishPc?.addTrack(localAudioTrack, listOf("ARDAMS"))

        if (_isVideoEnabled.value) {
            setupCameraCapture()
        }

        // Create Offer for Publish PC
        val sdpConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        publishPc?.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription?) {
                desc?.let {
                    publishPc?.setLocalDescription(SimpleSdpObserver(), it)
                    scope.launch {
                        currentChannelId?.let { chId ->
                            val offerPayload = CallOfferPayload(channelId = chId, sdp = it.description)
                            wsManager.sendSignaling("call_offer", json.encodeToJsonElement(offerPayload))
                        }
                    }
                }
            }
        }, sdpConstraints)

        // 2. Setup Subscribe Connection (for incoming streams from SFU)
        subscribePc = peerConnectionFactory?.createPeerConnection(rtcConfig, object : SimplePeerConnectionObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate?.let { sendCandidate(it, target = "subscribe") }
            }
        })
    }

    private fun setupCameraCapture() {
        val enumerator = Camera2Enumerator(context)
        val deviceName = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull() ?: return

        videoCapturer = enumerator.createCapturer(deviceName, null)
        val surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        val videoSource = peerConnectionFactory?.createVideoSource(videoCapturer!!.isScreencast)
        videoCapturer?.initialize(surfaceTextureHelper, context, videoSource?.capturerObserver)
        videoCapturer?.startCapture(1280, 720, 30)

        localVideoTrack = peerConnectionFactory?.createVideoTrack("ARDAMSv0", videoSource)
        publishPc?.addTrack(localVideoTrack, listOf("ARDAMS"))
    }

    private fun handlePublishAnswer(sdpString: String) {
        val sdp = SessionDescription(SessionDescription.Type.ANSWER, sdpString)
        publishPc?.setRemoteDescription(SimpleSdpObserver(), sdp)
    }

    private fun handleSubscribeOffer(sdpString: String) {
        val sdp = SessionDescription(SessionDescription.Type.OFFER, sdpString)
        subscribePc?.setRemoteDescription(object : SimpleSdpObserver() {
            override fun onSetSuccess() {
                subscribePc?.createAnswer(object : SimpleSdpObserver() {
                    override fun onCreateSuccess(desc: SessionDescription?) {
                        desc?.let {
                            subscribePc?.setLocalDescription(SimpleSdpObserver(), it)
                            scope.launch {
                                currentChannelId?.let { chId ->
                                    val answerPayload = CallAnswerPayload(channelId = chId, sdp = it.description)
                                    wsManager.sendSignaling("call_answer", json.encodeToJsonElement(answerPayload))
                                }
                            }
                        }
                    }
                }, MediaConstraints())
            }
        }, sdp)
    }

    private fun handleRemoteCandidate(payload: CallCandidatePayload) {
        val candidate = IceCandidate(payload.sdpMid, payload.sdpMLineIndex, payload.candidate)
        if (payload.target == "subscribe") {
            subscribePc?.addIceCandidate(candidate)
        } else {
            publishPc?.addIceCandidate(candidate)
        }
    }

    private fun sendCandidate(candidate: IceCandidate, target: String) {
        scope.launch {
            currentChannelId?.let { chId ->
                val candPayload = CallCandidatePayload(
                    channelId = chId,
                    candidate = candidate.sdp,
                    sdpMid = candidate.sdpMid,
                    sdpMLineIndex = candidate.sdpMLineIndex,
                    target = target
                )
                wsManager.sendSignaling("call_candidate", json.encodeToJsonElement(candPayload))
            }
        }
    }

    fun toggleMute() {
        val newMuted = !_isMuted.value
        localAudioTrack?.setEnabled(!newMuted)
        _isMuted.value = newMuted
    }

    fun toggleVideo() {
        val newVideo = !_isVideoEnabled.value
        localVideoTrack?.setEnabled(newVideo)
        _isVideoEnabled.value = newVideo
    }

    fun leaveCall() {
        scope.launch {
            currentChannelId?.let { chId ->
                val leavePayload = buildJsonObject { put("channel_id", chId) }
                wsManager.sendSignaling("call_leave", leavePayload)
            }
        }
        cleanup()
    }

    private fun cleanup() {
        try {
            videoCapturer?.stopCapture()
            videoCapturer?.dispose()
        } catch (_: Exception) {}

        publishPc?.dispose()
        subscribePc?.dispose()
        publishPc = null
        subscribePc = null

        _isInCall.value = false
        _isMuted.value = false
        _isVideoEnabled.value = false
        _participants.value = emptyList()
        currentChannelId = null
    }
}

open class SimplePeerConnectionObserver : PeerConnection.Observer {
    override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
    override fun onIceCandidate(candidate: IceCandidate?) {}
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
    override fun onAddStream(stream: org.webrtc.MediaStream?) {}
    override fun onRemoveStream(stream: org.webrtc.MediaStream?) {}
    override fun onDataChannel(channel: org.webrtc.DataChannel?) {}
    override fun onRenegotiationNeeded() {}
}

open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription?) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) {}
    override fun onSetFailure(error: String?) {}
}
