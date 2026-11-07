package com.cove.chat.rtc.udp

import io.github.jaredmdobson.concentus.OpusApplication
import io.github.jaredmdobson.concentus.OpusDecoder
import io.github.jaredmdobson.concentus.OpusEncoder
import io.github.jaredmdobson.concentus.OpusSignal

/**
 * Opus at 48 kHz mono in 20 ms frames, the protocol's mandatory audio codec (docs/udp-media.md section 4) and the
 * same parameters as the desktop client. Backed by Concentus, a pure Java Opus port: it runs unchanged on the JVM (so
 * the codec is unit tested) and avoids `MediaCodec`'s Opus encoder, which exists only on newer devices and exposes
 * neither in-band FEC nor DTX.
 */
object OpusFormat {
    const val SAMPLE_RATE = 48_000
    const val FRAME_MS = 20
    /** Samples per channel in one 20 ms frame. */
    const val FRAME_SAMPLES = SAMPLE_RATE / 1000 * FRAME_MS
    const val BITRATE = 32_000
    /** Upper bound of one encoded frame we accept; protects the decoder from oversized input. */
    const val MAX_PACKET = 1275
}

/** Encodes 20 ms mono PCM frames. Not thread safe; use from the capture thread only. */
class OpusFrameEncoder(bitrate: Int = OpusFormat.BITRATE, dtx: Boolean = true) {
    private val enc = OpusEncoder(OpusFormat.SAMPLE_RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP).apply {
        setBitrate(bitrate)
        setSignalType(OpusSignal.OPUS_SIGNAL_VOICE)
        setComplexity(5) // a good quality/CPU balance for a pure-Java encoder on phones
        setUseInbandFEC(true) // lets the receiver rebuild one lost frame from the next packet
        setPacketLossPercent(10)
        setUseDTX(dtx) // near-silence collapses to 1-2 byte packets
        setUseVBR(true)
    }
    private val out = ByteArray(OpusFormat.MAX_PACKET)

    /** Encodes exactly [OpusFormat.FRAME_SAMPLES] samples starting at [offset]; returns a fresh array of the packet. */
    fun encode(pcm: ShortArray, offset: Int = 0): ByteArray {
        require(pcm.size - offset >= OpusFormat.FRAME_SAMPLES) { "need a full 20 ms frame" }
        val n = enc.encode(pcm, offset, OpusFormat.FRAME_SAMPLES, out, 0, out.size)
        return out.copyOf(n)
    }

    /** Lets the encoder plan for more or less in-band redundancy as the observed loss changes. */
    fun setExpectedLossPercent(percent: Int) = enc.setPacketLossPercent(percent.coerceIn(0, 100))
}

/** Decodes the stream of one remote participant. Not thread safe; one instance per sender. */
class OpusFrameDecoder {
    private val dec = OpusDecoder(OpusFormat.SAMPLE_RATE, 1)

    /** Decodes a packet into [out] (at least one frame long); returns the number of samples written. */
    fun decode(packet: ByteArray, out: ShortArray): Int {
        if (packet.isEmpty() || packet.size > OpusFormat.MAX_PACKET) return conceal(out)
        return dec.decode(packet, 0, packet.size, out, 0, OpusFormat.FRAME_SAMPLES, false)
    }

    /** Rebuilds the frame *before* [nextPacket] from its in-band FEC data (only meaningful when that frame was lost). */
    fun decodeLostFrom(nextPacket: ByteArray, out: ShortArray): Int {
        if (nextPacket.isEmpty() || nextPacket.size > OpusFormat.MAX_PACKET) return conceal(out)
        return dec.decode(nextPacket, 0, nextPacket.size, out, 0, OpusFormat.FRAME_SAMPLES, true)
    }

    /** Packet loss concealment: extrapolates from the decoder state. */
    fun conceal(out: ShortArray): Int = dec.decode(null, 0, 0, out, 0, OpusFormat.FRAME_SAMPLES, false)
}
