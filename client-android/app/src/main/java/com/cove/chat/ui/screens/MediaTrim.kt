package com.cove.chat.ui.screens

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/** Cuts a recorded MP4 (video + audio) without re-encoding it. */
object MediaTrim {
    /**
     * Copies the samples between [startUs] and [endUs] of [src] into a new MP4 at [dst]. Video can only start on a
     * key frame, so the cut begins at the key frame at or before [startUs] (usually within a second) and the audio is
     * aligned to that same point. Returns false on any failure, in which case [dst] is removed and the caller should
     * send the untrimmed recording.
     */
    fun trimMp4(src: File, dst: File, startUs: Long, endUs: Long): Boolean {
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        var started = false
        return try {
            extractor.setDataSource(src.absolutePath)
            muxer = MediaMuxer(dst.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val outTracks = HashMap<Int, Int>()
            var bufferSize = 256 * 1024
            var videoTrack = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME).orEmpty()
                if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
                if (mime.startsWith("video/") && videoTrack < 0) videoTrack = i
                extractor.selectTrack(i)
                outTracks[i] = muxer.addTrack(format)
                if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) bufferSize = maxOf(bufferSize, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
            }
            if (outTracks.isEmpty()) return false
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            // The first sample after the seek is the key frame the cut really starts on.
            val origin = extractor.sampleTime.coerceAtLeast(0L)
            muxer.start()
            started = true

            val buffer = ByteBuffer.allocate(bufferSize)
            val info = MediaCodec.BufferInfo()
            while (true) {
                buffer.clear()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                val time = extractor.sampleTime
                val track = extractor.sampleTrackIndex
                if (time > endUs) break
                val out = outTracks[track]
                if (out != null && time >= origin) {
                    info.set(0, size, time - origin, extractor.sampleFlags)
                    muxer.writeSampleData(out, buffer, info)
                }
                extractor.advance()
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            runCatching { if (started) muxer?.stop() }
            runCatching { muxer?.release() }
            runCatching { extractor.release() }
        }.also { ok -> if (!ok || !dst.exists() || dst.length() == 0L) dst.delete() }.let { ok -> ok && dst.exists() }
    }
}
