package com.cove.chat.rtc.udp

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * Microphone capture, Opus encoding, per-sender decoding with a jitter buffer, mixing and playout for the encrypted
 * UDP call path. Two threads: a capture thread paced by `AudioRecord.read` and a playout thread paced by the blocking
 * `AudioTrack.write`, so neither needs a timer. Output routing (earpiece / speaker / Bluetooth) is the shared
 * `CallAudioRouter`'s job; this class only produces `USAGE_VOICE_COMMUNICATION` audio so the platform follows it.
 *
 * @param onPacket receives each encoded 20 ms Opus packet and its timestamp in milliseconds (sample count / 48).
 */
class UdpAudioEngine(private val onPacket: (data: ByteArray, tsMs: Long) -> Unit) {
    private class Remote {
        val jitter = AudioJitterBuffer()
        val decoder = OpusFrameDecoder()
        @Volatile var level = 0.0
    }

    private val remotes = ConcurrentHashMap<String, Remote>()
    @Volatile private var running = false
    private var captureThread: Thread? = null
    private var playoutThread: Thread? = null

    /** While true the microphone is read but nothing is encoded or sent. */
    @Volatile var muted = false

    /** While true incoming audio is not played (and its buffers are flushed so un-deafening starts fresh). */
    @Volatile var deafened = false

    /** Latest microphone level (RMS 0..1), 0 while muted. */
    @Volatile var localLevel = 0.0
        private set

    /** Set when the microphone could not be opened (permission denied or busy); playout still works. */
    @Volatile var micFailed = false
        private set

    /** Starts capture and playout. [echoCancel] / [noiseSuppress] enable the platform effects when the device has them. */
    fun start(echoCancel: Boolean, noiseSuppress: Boolean) {
        if (running) return
        running = true
        playoutThread = Thread({ playoutLoop() }, "udp-audio-play").apply { priority = Thread.MAX_PRIORITY; start() }
        captureThread = Thread({ captureLoop(echoCancel, noiseSuppress) }, "udp-audio-capture").apply { priority = Thread.MAX_PRIORITY; start() }
    }

    /** Queues one reassembled Opus frame from [userId]. */
    fun feed(userId: String, frameId: Long, data: ByteArray) {
        remotes.getOrPut(userId) { Remote() }.let { r -> synchronized(r) { r.jitter.push(frameId, data) } }
    }

    fun removeRemote(userId: String) { remotes.remove(userId) }

    fun clearRemotes() = remotes.clear()

    /** Per-sender output level (RMS 0..1), for the speaking indicator. */
    fun remoteLevels(): Map<String, Double> = remotes.mapValues { it.value.level }

    fun stop() {
        running = false
        runCatching { captureThread?.join(500) }
        runCatching { playoutThread?.join(500) }
        captureThread = null; playoutThread = null
        remotes.clear()
        localLevel = 0.0
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO is requested before a call starts; a SecurityException is handled below
    private fun captureLoop(echoCancel: Boolean, noiseSuppress: Boolean) {
        val frame = OpusFormat.FRAME_SAMPLES
        val min = AudioRecord.getMinBufferSize(OpusFormat.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        var rec: AudioRecord? = null
        var aec: AcousticEchoCanceler? = null
        var ns: NoiseSuppressor? = null
        try {
            rec = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION, OpusFormat.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, frame * 2 * 4),
            )
            if (rec.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("AudioRecord not initialised")
            if (echoCancel && AcousticEchoCanceler.isAvailable()) aec = AcousticEchoCanceler.create(rec.audioSessionId)?.also { it.enabled = true }
            if (noiseSuppress && NoiseSuppressor.isAvailable()) ns = NoiseSuppressor.create(rec.audioSessionId)?.also { it.enabled = true }
            rec.startRecording()
        } catch (e: Exception) {
            Log.w(TAG, "microphone unavailable: ${e.javaClass.simpleName}")
            micFailed = true
            runCatching { rec?.release() }
            return
        }
        val encoder = OpusFrameEncoder()
        val pcm = ShortArray(frame)
        var samples = 0L
        try {
            while (running) {
                var got = 0
                while (got < frame && running) {
                    val n = rec.read(pcm, got, frame - got, AudioRecord.READ_BLOCKING)
                    if (n < 0) { Log.w(TAG, "AudioRecord.read failed: $n"); return }
                    got += n
                }
                if (got < frame) break
                val tsMs = samples / (OpusFormat.SAMPLE_RATE / 1000)
                samples += frame
                if (muted) { localLevel = 0.0; continue }
                localLevel = SpeakingTracker.level(pcm, frame)
                onPacket(encoder.encode(pcm), tsMs)
            }
        } finally {
            runCatching { rec.stop() }
            aec?.release(); ns?.release()
            rec.release()
        }
    }

    private fun playoutLoop() {
        val frame = OpusFormat.FRAME_SAMPLES
        val min = AudioTrack.getMinBufferSize(OpusFormat.SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(OpusFormat.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(maxOf(min, frame * 2 * 4))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                .build()
        } catch (e: Exception) {
            Log.w(TAG, "audio output unavailable: ${e.javaClass.simpleName}")
            return
        }
        val mix = IntArray(frame)
        val out = ShortArray(frame)
        val tmp = ShortArray(frame)
        try {
            track.play()
            while (running) {
                java.util.Arrays.fill(mix, 0)
                if (deafened) {
                    remotes.values.forEach { r -> synchronized(r) { r.jitter.reset() }; r.level = 0.0 }
                } else {
                    for (r in remotes.values) {
                        val n = decodeNext(r, tmp)
                        r.level = if (n > 0) SpeakingTracker.level(tmp, n) else 0.0
                        for (i in 0 until n) mix[i] += tmp[i]
                    }
                }
                for (i in 0 until frame) out[i] = mix[i].coerceIn(-32768, 32767).toShort()
                // Blocking write: this is the 20 ms clock. A negative result (dead object after a route change) must not spin.
                if (track.write(out, 0, frame) < 0) Thread.sleep(OpusFormat.FRAME_MS.toLong())
            }
        } finally {
            runCatching { track.stop() }
            track.release()
        }
    }

    /** Pulls the next 20 ms from [r]; returns the number of samples written to [out] (0 = silence). */
    private fun decodeNext(r: Remote, out: ShortArray): Int {
        val step = synchronized(r) { r.jitter.pull() }
        return try {
            when (step) {
                is PlayoutStep.Packet -> r.decoder.decode(step.data, out)
                is PlayoutStep.Recover -> r.decoder.decodeLostFrom(step.nextData, out)
                PlayoutStep.Conceal -> r.decoder.conceal(out)
                PlayoutStep.Silence -> 0
            }
        } catch (e: Exception) {
            // A corrupt packet must never take the call down; conceal this frame instead.
            runCatching { r.decoder.conceal(out) }.getOrDefault(0)
        }
    }

    private companion object {
        const val TAG = "UdpAudio"
    }
}
