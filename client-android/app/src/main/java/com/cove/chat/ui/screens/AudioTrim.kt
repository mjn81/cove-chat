package com.cove.chat.ui.screens

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Trimming helpers for the voice-note preview. The range maths and waveform slicing are plain functions (unit
 * tested); [trimAac] cuts the recorded AAC/MP4 file without decoding or re-encoding it.
 */
object AudioTrim {
    /** Shortest voice note the trim handles allow, in milliseconds. */
    const val MIN_LENGTH_MS = 1_000L

    /** The smallest gap between the two handles, as a fraction of the whole recording. */
    fun minGapFraction(totalMs: Long, minMs: Long = MIN_LENGTH_MS): Float =
        if (totalMs <= 0) 1f else (minMs.toFloat() / totalMs).coerceIn(0f, 1f)

    /** Moves the start handle to [wanted], keeping it inside 0..(end - minGap). */
    fun moveStart(wanted: Float, end: Float, minGap: Float): Float = wanted.coerceIn(0f, max(0f, end - minGap))

    /** Moves the end handle to [wanted], keeping it inside (start + minGap)..1. */
    fun moveEnd(wanted: Float, start: Float, minGap: Float): Float = wanted.coerceIn(min(1f, start + minGap), 1f)

    /** True when the handles are (almost) at the ends, so the original file can be sent untouched. */
    fun isFullRange(start: Float, end: Float): Boolean = start < 0.005f && end > 0.995f

    /** Length of the kept part in whole seconds, never below 1. */
    fun trimmedSeconds(totalMs: Long, start: Float, end: Float): Int =
        max(1, Math.round((end - start) * totalMs / 1000f))

    /**
     * The part of a waveform between [start] and [end] (fractions of the whole), resampled to [outCount] buckets
     * by taking the loudest value in each, so the trimmed message still carries a full-width waveform.
     */
    fun slicePeaks(peaks: ByteArray, start: Float, end: Float, outCount: Int = peaks.size): ByteArray {
        if (peaks.isEmpty() || outCount <= 0) return ByteArray(max(outCount, 0))
        val from = floor(start.coerceIn(0f, 1f) * peaks.size).toInt().coerceIn(0, peaks.size - 1)
        val to = ceil(end.coerceIn(0f, 1f) * peaks.size).toInt().coerceIn(from + 1, peaks.size)
        val span = to - from
        return ByteArray(outCount) { i ->
            val a = from + i * span / outCount
            val b = max(a + 1, from + (i + 1) * span / outCount).coerceAtMost(to)
            var peak = 0
            for (j in a until b) peak = max(peak, peaks[j].toInt())
            peak.toByte()
        }
    }

    /**
     * Copies the AAC samples between [startUs] and [endUs] of [src] into a new MP4 at [dst] without re-encoding.
     * AAC frames are independent, so the cut is accurate to one frame (about 23 ms). Returns false on any failure,
     * in which case [dst] is removed and the caller should send the untrimmed recording.
     */
    fun trimAac(src: File, dst: File, startUs: Long, endUs: Long): Boolean {
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        var started = false
        return try {
            extractor.setDataSource(src.absolutePath)
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return false
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            muxer = MediaMuxer(dst.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val out = muxer.addTrack(format)
            muxer.start()
            started = true

            val buffer = ByteBuffer.allocate(if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 256 * 1024)
            val info = MediaCodec.BufferInfo()
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            while (true) {
                buffer.clear()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                val time = extractor.sampleTime
                if (time > endUs) break
                if (time >= startUs) {
                    // Every AAC frame is a sync sample; some devices report 0 flags, so set it explicitly.
                    info.set(0, size, time - startUs, MediaCodec.BUFFER_FLAG_KEY_FRAME)
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
            if (!dst.exists() || dst.length() == 0L) dst.delete()
        }.also { ok -> if (!ok) dst.delete() }
    }
}
