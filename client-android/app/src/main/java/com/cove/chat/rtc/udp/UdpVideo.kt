package com.cove.chat.rtc.udp

import android.media.MediaCodecInfo
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import org.webrtc.EglBase
import org.webrtc.EncodedImage
import org.webrtc.HardwareVideoDecoderFactory
import org.webrtc.HardwareVideoEncoderFactory
import org.webrtc.JavaI420Buffer
import org.webrtc.PeerConnectionFactory
import org.webrtc.PlatformSoftwareVideoDecoderFactory
import org.webrtc.Predicate
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoCodecStatus
import org.webrtc.VideoDecoder
import org.webrtc.VideoEncoder
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.YuvHelper
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger

/** `H264` as libwebrtc's codec factories name it. */
private val H264_INFO = VideoCodecInfo("H264", mapOf("profile-level-id" to "42e01f", "level-asymmetry-allowed" to "1", "packetization-mode" to "1"), emptyList())

/**
 * Encodes frames from a capturer's [VideoTrack] to Constrained Baseline H.264 in Annex-B for the UDP media protocol
 * (docs/udp-media.md section 4: codec 3, keyframes carry SPS+PPS, frames up to 70 400 bytes).
 *
 * Uses libwebrtc's own MediaCodec wrapper (`HardwareVideoEncoderFactory`) rather than hand-rolled MediaCodec code: it
 * accepts the capturer's GL texture frames without a copy, handles the many vendor colour-format quirks, applies rate
 * control, and prepends SPS/PPS to every keyframe. Everything runs on one dedicated thread because that wrapper is
 * thread-affine. Frames arriving while two are already queued are dropped so latency never builds up.
 *
 * @param send delivers an encoded access unit; returns false when it does not fit the protocol's frame limit.
 * @param onOversize invoked when [send] refused a frame (the caller should lower the bitrate).
 */
class H264Publisher(
    private val egl: EglBase,
    private val tag: String,
    private val send: (keyframe: Boolean, tsMs: Long, data: ByteArray) -> Boolean,
    private val onOversize: () -> Unit,
    private val onError: (String) -> Unit,
) : VideoSink {
    private val thread = HandlerThread("udp-enc-$tag").apply { start() }
    private val handler = Handler(thread.looper)
    private val queued = AtomicInteger(0)
    private val keyframes = KeyframeLimiter()

    // Touched on the encoder thread only (plus the volatile request flag).
    private var encoder: VideoEncoder? = null
    private var width = 0
    private var height = 0
    private var bitrateBps = 1_000_000
    private var fps = 30
    @Volatile private var wantKey = true
    private var lastKeyAtMs = 0L
    @Volatile private var stopped = false

    /** Asks for a keyframe at the next frame, honouring the rate limit (at most one per 500 ms). */
    fun requestKeyframe() {
        if (keyframes.allow(SystemClock.elapsedRealtime())) wantKey = true
    }

    /** Sets the target bitrate (bits per second) and frame rate; takes effect immediately. */
    fun setRate(bps: Int, framesPerSecond: Int) {
        handler.post {
            bitrateBps = bps; fps = framesPerSecond
            applyRate()
        }
    }

    override fun onFrame(frame: VideoFrame) {
        if (stopped) return
        if (queued.get() >= MAX_QUEUED) return
        queued.incrementAndGet()
        frame.retain()
        if (!handler.post { try { encode(frame) } finally { frame.release(); queued.decrementAndGet() } }) {
            frame.release(); queued.decrementAndGet()
        }
    }

    private fun encode(frame: VideoFrame) {
        if (stopped) return
        val upright = upright(frame) ?: return
        try {
            val w = upright.buffer.width
            val h = upright.buffer.height
            if (encoder == null || w != width || h != height) {
                if (!initEncoder(w, h)) { stopped = true; return }
            }
            val now = SystemClock.elapsedRealtime()
            val key = wantKey || now - lastKeyAtMs >= KEYFRAME_INTERVAL_MS
            if (key) { wantKey = false; lastKeyAtMs = now }
            val type = if (key) EncodedImage.FrameType.VideoFrameKey else EncodedImage.FrameType.VideoFrameDelta
            val status = encoder?.encode(upright, VideoEncoder.EncodeInfo(arrayOf(type)))
            if (status != null && status != VideoCodecStatus.OK && status != VideoCodecStatus.NO_OUTPUT) {
                Log.w(TAG, "$tag encode status $status")
                if (status == VideoCodecStatus.ERROR || status == VideoCodecStatus.FALLBACK_SOFTWARE) { releaseEncoder(); wantKey = true }
            }
        } finally {
            upright.release()
        }
    }

    /**
     * The protocol has no rotation field (unlike RTP's CVO extension), so a portrait camera frame must be turned
     * upright before encoding. Frames with rotation 0 (screen capture, landscape) are passed through untouched and
     * stay on the GPU path. The returned frame holds its own reference.
     */
    private fun upright(frame: VideoFrame): VideoFrame? {
        if (frame.rotation == 0) { frame.retain(); return frame }
        val src = frame.buffer.toI420() ?: return null
        val swap = frame.rotation == 90 || frame.rotation == 270
        val dst = JavaI420Buffer.allocate(if (swap) src.height else src.width, if (swap) src.width else src.height)
        try {
            YuvHelper.I420Rotate(
                src.dataY, src.strideY, src.dataU, src.strideU, src.dataV, src.strideV,
                dst.dataY, dst.strideY, dst.dataU, dst.strideU, dst.dataV, dst.strideV,
                src.width, src.height, frame.rotation,
            )
        } finally {
            src.release()
        }
        return VideoFrame(dst, 0, frame.timestampNs)
    }

    private fun createEncoder(): VideoEncoder? {
        // Hardware first; a device with only a software AVC encoder still beats having no video at all.
        // Ask the factory for the exact codec description it advertises (Constrained Baseline, as high profile is disabled).
        val hw = HardwareVideoEncoderFactory(egl.eglBaseContext, false, false)
        hw.supportedCodecs.firstOrNull { it.name.equals("H264", true) }?.let { info -> hw.createEncoder(info)?.let { return it } }
        return fallbackEncoder()
    }

    private fun fallbackEncoder(): VideoEncoder? {
        val any = HardwareVideoEncoderFactory(egl.eglBaseContext, false, false, Predicate<MediaCodecInfo> { true })
        val info = any.supportedCodecs.firstOrNull { it.name.equals("H264", true) } ?: return null
        return any.createEncoder(info)
    }

    private fun initEncoder(w: Int, h: Int): Boolean {
        releaseEncoder()
        val enc = createEncoder() ?: run { onError("This device has no H.264 encoder."); return false }
        val settings = VideoEncoder.Settings(1, w, h, bitrateBps / 1000, fps, 1, false, VideoEncoder.Capabilities(false))
        val status = enc.initEncode(settings, VideoEncoder.Callback { image, _ -> deliver(image) })
        if (status != VideoCodecStatus.OK) { onError("Couldn't start the video encoder ($status)."); enc.release(); return false }
        encoder = enc; width = w; height = h
        wantKey = true
        applyRate()
        Log.d(TAG, "$tag encoder ${enc.implementationName} ${w}x$h @${bitrateBps / 1000}kbps")
        return true
    }

    private fun applyRate() {
        encoder?.setRateAllocation(VideoEncoder.BitrateAllocation(arrayOf(intArrayOf(bitrateBps))), fps)
    }

    private fun deliver(image: EncodedImage) {
        val buf: ByteBuffer = image.buffer
        val data = ByteArray(buf.remaining())
        buf.duplicate().get(data)
        val key = image.frameType == EncodedImage.FrameType.VideoFrameKey
        // A keyframe the receiver cannot start from (no SPS) is useless; ask for another instead of sending it.
        if (key && H264Sps.size(data) == null) { wantKey = true; return }
        if (!send(key, image.captureTimeMs, data)) { wantKey = true; onOversize() }
    }

    private fun releaseEncoder() {
        runCatching { encoder?.release() }
        encoder = null
    }

    /** Stops encoding and frees the codec; the publisher cannot be reused. */
    fun stop() {
        stopped = true
        handler.post { releaseEncoder(); thread.quitSafely() }
    }

    private companion object {
        const val TAG = "UdpVideoPub"
        const val MAX_QUEUED = 2
        const val KEYFRAME_INTERVAL_MS = 5_000L
    }
}

/**
 * Decodes one remote participant's H.264 stream (camera or screen) and exposes it as a normal libwebrtc [VideoTrack],
 * so the existing call tiles, spotlight and full-screen viewer render it exactly like a WebRTC track. Decoded frames
 * (GPU textures from MediaCodec) are pushed into a [VideoSource].
 *
 * @param needKeyframe invoked when decoding cannot continue without a fresh keyframe.
 */
class H264Subscriber(
    factory: PeerConnectionFactory,
    private val egl: EglBase,
    private val label: String,
    isScreen: Boolean,
    private val needKeyframe: () -> Unit,
) {
    private val source: VideoSource = factory.createVideoSource(isScreen)

    /** The track the UI attaches its renderer to. */
    val track: VideoTrack = factory.createVideoTrack("udp-$label", source)
    private val thread = HandlerThread("udp-dec-$label").apply { start() }
    private val handler = Handler(thread.looper)
    private val queued = AtomicInteger(0)
    private var decoder: VideoDecoder? = null
    private var width = 0
    private var height = 0
    private var started = false
    @Volatile private var disposed = false

    init { source.capturerObserver.onCapturerStarted(true) }

    /** Queues a reassembled access unit. Delta frames are dropped when the decoder is badly behind (it resyncs on a keyframe). */
    fun decode(keyframe: Boolean, tsMs: Long, data: ByteArray) {
        if (disposed) return
        if (!keyframe && queued.get() > MAX_QUEUED) { needKeyframe(); return }
        queued.incrementAndGet()
        if (!handler.post { try { decodeNow(keyframe, tsMs, data) } finally { queued.decrementAndGet() } }) queued.decrementAndGet()
    }

    private fun decodeNow(keyframe: Boolean, tsMs: Long, data: ByteArray) {
        if (disposed) return
        if (decoder == null && !keyframe) return // nothing to reference yet; the reassembler keeps asking for a keyframe
        if (keyframe) {
            val size = H264Sps.size(data)
            if (size == null) { needKeyframe(); return }
            if (decoder == null || size.width != width || size.height != height) {
                if (!initDecoder(size.width, size.height)) return
            }
            started = true
        }
        if (!started) return
        val dec = decoder ?: return
        val bb = ByteBuffer.allocateDirect(data.size).put(data).also { it.flip() }
        val image = EncodedImage.builder()
            .setBuffer(bb, null)
            .setEncodedWidth(width).setEncodedHeight(height)
            .setCaptureTimeMs(tsMs).setCaptureTimeNs(tsMs * 1_000_000L)
            .setFrameType(if (keyframe) EncodedImage.FrameType.VideoFrameKey else EncodedImage.FrameType.VideoFrameDelta)
            .setRotation(0)
            .createEncodedImage()
        val status = dec.decode(image, VideoDecoder.DecodeInfo(false, 0))
        if (status != VideoCodecStatus.OK) {
            Log.w(TAG, "$label decode status $status")
            started = false
            releaseDecoder()
            needKeyframe()
        }
    }

    private fun initDecoder(w: Int, h: Int): Boolean {
        releaseDecoder()
        val dec = HardwareVideoDecoderFactory(egl.eglBaseContext).createDecoder(H264_INFO)
            ?: PlatformSoftwareVideoDecoderFactory(egl.eglBaseContext).createDecoder(H264_INFO)
        if (dec == null) { Log.w(TAG, "$label: no H.264 decoder on this device"); return false }
        val status = dec.initDecode(VideoDecoder.Settings(1, w, h)) { frame, _, _ -> if (!disposed) source.capturerObserver.onFrameCaptured(frame) }
        if (status != VideoCodecStatus.OK) { dec.release(); Log.w(TAG, "$label initDecode $status"); return false }
        decoder = dec; width = w; height = h
        Log.d(TAG, "$label decoder ${dec.implementationName} ${w}x$h")
        return true
    }

    private fun releaseDecoder() {
        runCatching { decoder?.release() }
        decoder = null
    }

    /** Stops decoding and releases the track; the subscriber cannot be reused. */
    fun dispose() {
        disposed = true
        handler.post {
            releaseDecoder()
            thread.quitSafely()
            runCatching { source.capturerObserver.onCapturerStopped() }
            runCatching { track.dispose() }
            runCatching { source.dispose() }
        }
    }

    private companion object {
        const val TAG = "UdpVideoSub"
        const val MAX_QUEUED = 6
    }
}
