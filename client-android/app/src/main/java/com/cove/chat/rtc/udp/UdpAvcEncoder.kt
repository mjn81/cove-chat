package com.cove.chat.rtc.udp

import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Bundle
import android.util.Log
import org.webrtc.VideoFrame
import java.nio.ByteBuffer

/**
 * Plain `MediaCodec` H.264 encoder fed with I420 byte buffers. libwebrtc's own encoder wrapper only accepts codecs
 * from a short vendor allow-list (it rejects the Android emulator's and several OEM codecs), so [H264Publisher] falls
 * back to this one, which works with any device that ships an `video/avc` encoder, hardware or software. It costs a GPU
 * read-back for texture frames, which is acceptable at call resolutions.
 *
 * Output is Annex-B; the codec's SPS/PPS (delivered once as a config buffer) are prepended to every keyframe, as the
 * protocol requires. All methods must be called from one thread.
 */
class AvcByteBufferEncoder(private val onOutput: (keyframe: Boolean, tsMs: Long, data: ByteArray) -> Unit) {
    private var codec: MediaCodec? = null
    private var config: ByteArray? = null
    private var width = 0
    private var height = 0

    /** Starts an encoder for [w]x[h]; false when the device has none or refuses the configuration. */
    fun start(w: Int, h: Int, bitrateBps: Int, fps: Int): Boolean {
        release()
        val names = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .filter { it.isEncoder && it.supportedTypes.any { t -> t.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) } }
            .map { it.name }
        // Hardware encoders list first on devices that have them; the platform software one is the last resort.
        for (name in names) {
            try {
                val c = MediaCodec.createByCodecName(name)
                val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
                    setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                    setInteger(MediaFormat.KEY_BIT_RATE, bitrateBps)
                    setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 5)
                    setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
                }
                c.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                c.start()
                codec = c; width = w; height = h; config = null
                Log.d(TAG, "using $name ${w}x$h")
                return true
            } catch (e: Exception) {
                Log.w(TAG, "encoder $name unusable: ${e.javaClass.simpleName}")
            }
        }
        return false
    }

    /** Applies a new target bitrate to the running encoder. */
    fun setBitrate(bps: Int) {
        runCatching { codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, bps) }) }
    }

    /** Encodes one upright frame; [forceKey] asks for an IDR frame. Drops the frame if the codec has no free input. */
    fun encode(i420: VideoFrame.I420Buffer, tsUs: Long, forceKey: Boolean) {
        val c = codec ?: return
        if (i420.width != width || i420.height != height) return
        if (forceKey) runCatching { c.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) }) }
        val idx = c.dequeueInputBuffer(5_000)
        if (idx >= 0) {
            val img = c.getInputImage(idx)
            if (img != null) {
                copy(i420.dataY, i420.strideY, width, height, img.planes[0])
                copy(i420.dataU, i420.strideU, width / 2, height / 2, img.planes[1])
                copy(i420.dataV, i420.strideV, width / 2, height / 2, img.planes[2])
                c.queueInputBuffer(idx, 0, width * height * 3 / 2, tsUs, 0)
            } else c.queueInputBuffer(idx, 0, 0, tsUs, 0)
        }
        drain(c)
    }

    private fun drain(c: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        while (true) {
            val out = c.dequeueOutputBuffer(info, 2_000)
            if (out < 0) return // try again / format changed / buffers changed: nothing to emit now
            val buf = c.getOutputBuffer(out)
            if (buf != null && info.size > 0) {
                buf.position(info.offset); buf.limit(info.offset + info.size)
                val bytes = ByteArray(info.size)
                buf.get(bytes)
                if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                    config = bytes
                } else {
                    val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                    val cfg = config
                    val data = if (key && cfg != null && !H264Sps.nalTypes(bytes).contains(7)) cfg + bytes else bytes
                    onOutput(key, info.presentationTimeUs / 1000, data)
                }
            }
            c.releaseOutputBuffer(out, false)
        }
    }

    /** Copies one I420 plane into a codec input image plane honouring its row and pixel strides. */
    private fun copy(src: ByteBuffer, srcStride: Int, w: Int, h: Int, dst: Image.Plane) {
        val d = dst.buffer
        val rowStride = dst.rowStride
        val pixelStride = dst.pixelStride
        val row = ByteArray(w)
        val s = src.duplicate()
        for (y in 0 until h) {
            s.position(y * srcStride)
            s.get(row, 0, w)
            if (pixelStride == 1) {
                d.position(y * rowStride)
                d.put(row, 0, w)
            } else {
                val base = y * rowStride
                for (x in 0 until w) d.put(base + x * pixelStride, row[x])
            }
        }
    }

    fun release() {
        runCatching { codec?.stop() }
        runCatching { codec?.release() }
        codec = null
        config = null
    }

    private companion object {
        const val TAG = "UdpAvcEnc"
    }
}
