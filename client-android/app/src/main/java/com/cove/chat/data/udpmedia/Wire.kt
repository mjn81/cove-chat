package com.cove.chat.data.udpmedia

/**
 * Wire format of Cove's encrypted UDP media protocol (docs/udp-media.md section 4). Pure Kotlin so the exact-bytes
 * vectors of `backend/tests/udpmedia_vectors_test.go` can be checked on the JVM. All integers are big-endian.
 */
object Wire {
    const val MAGIC: Int = 0xC1
    const val HEADER_LEN = 20
    const val TAG_LEN = 16
    const val MAX_PACKET = 1200
    const val MAX_PLAINTEXT = MAX_PACKET - HEADER_LEN - TAG_LEN
    const val MEDIA_HEADER_LEN = 18
    const val MAX_FRAGMENT_PAYLOAD = 1100
    const val MAX_FRAGMENTS = 64
    const val HELLO_PLAINTEXT_LEN = 64
    const val SESSION_ID_LEN = 8
    const val MAX_NACK_ITEMS = 32
    const val ALL_FRAGMENTS = 0xFFFF
    const val NONCE_LEN = 16
}

/** Packet types (second header byte). */
object PacketType {
    const val HELLO = 1
    const val HELLO_ACK = 2
    const val MEDIA = 3
    const val NACK = 4
    const val KEYFRAME_REQ = 5
    const val BYE = 6
}

/** Stream kinds; they match the `audio` / `video` / `screen` track names of the WebSocket signalling. */
enum class Kind(val id: Int, val trackName: String) {
    AUDIO(1, "audio"), VIDEO(2, "video"), SCREEN(3, "screen");

    companion object {
        fun of(id: Int): Kind? = entries.firstOrNull { it.id == id }
    }
}

/** Codec identifiers (opaque to the server). */
object Codec {
    const val OPUS = 1
    const val VP8 = 2
    const val H264 = 3
    const val VP9 = 4
}

/** Media flag bits. */
object Flags {
    const val KEYFRAME = 1
    const val DISCARDABLE = 2
}

/** Why a packet or payload was rejected. Never carries packet contents. */
class UdpMediaException(val reason: Reason) : Exception(reason.name) {
    enum class Reason { SHORT_PACKET, BAD_MAGIC, TOO_LARGE, WRONG_SESSION, AUTH, REPLAY, BAD_EPOCH, MALFORMED }
}

/** The cleartext header of a packet; it is also the AEAD associated data. */
class PacketHeader(val type: Int, val epoch: Int, val sessionId: ByteArray, val seq: Long) {
    internal fun write(): ByteArray {
        val out = ByteArray(Wire.HEADER_LEN)
        out[0] = Wire.MAGIC.toByte()
        out[1] = type.toByte()
        out[2] = epoch.toByte()
        out[3] = 0
        System.arraycopy(sessionId, 0, out, 4, Wire.SESSION_ID_LEN)
        for (i in 0 until 8) out[12 + i] = (seq ushr (56 - 8 * i)).toByte()
        return out
    }

    companion object {
        /** Reads the header without authenticating it. */
        fun parse(pkt: ByteArray, len: Int = pkt.size): PacketHeader {
            if (len > Wire.MAX_PACKET) throw UdpMediaException(UdpMediaException.Reason.TOO_LARGE)
            if (len < Wire.HEADER_LEN + Wire.TAG_LEN) throw UdpMediaException(UdpMediaException.Reason.SHORT_PACKET)
            if ((pkt[0].toInt() and 0xFF) != Wire.MAGIC) throw UdpMediaException(UdpMediaException.Reason.BAD_MAGIC)
            var seq = 0L
            for (i in 0 until 8) seq = (seq shl 8) or (pkt[12 + i].toLong() and 0xFF)
            return PacketHeader(pkt[1].toInt() and 0xFF, pkt[2].toInt() and 0xFF, pkt.copyOfRange(4, 12), seq)
        }
    }
}

/** Header at the start of a MEDIA plaintext. */
data class MediaHeader(
    val src: Int = 0,
    val kind: Kind,
    val codec: Int,
    val flags: Int = 0,
    val frameId: Long,
    val fragIdx: Int = 0,
    val fragCnt: Int = 1,
    val ts: Long = 0,
) {
    val keyframe: Boolean get() = flags and Flags.KEYFRAME != 0
}

/** A parsed MEDIA plaintext: header plus payload. */
class MediaPacket(val header: MediaHeader, val payload: ByteArray)

object MediaCodec {
    /** Serialises the header followed by [payload] bytes `[off, off+len)`. */
    fun encode(h: MediaHeader, payload: ByteArray, off: Int = 0, len: Int = payload.size): ByteArray {
        val out = ByteArray(Wire.MEDIA_HEADER_LEN + len)
        putU16(out, 0, h.src)
        out[2] = h.kind.id.toByte()
        out[3] = h.codec.toByte()
        out[4] = h.flags.toByte()
        out[5] = 0
        putU32(out, 6, h.frameId)
        putU16(out, 10, h.fragIdx)
        putU16(out, 12, h.fragCnt)
        putU32(out, 14, h.ts)
        System.arraycopy(payload, off, out, Wire.MEDIA_HEADER_LEN, len)
        return out
    }

    /** Parses and validates a MEDIA plaintext the same way the Go `ParseMedia` does. */
    fun decode(b: ByteArray): MediaPacket {
        if (b.size < Wire.MEDIA_HEADER_LEN) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        val kind = Kind.of(b[2].toInt() and 0xFF)
        val fragIdx = getU16(b, 10)
        val fragCnt = getU16(b, 12)
        val payloadLen = b.size - Wire.MEDIA_HEADER_LEN
        if (kind == null || fragCnt == 0 || fragCnt > Wire.MAX_FRAGMENTS || fragIdx >= fragCnt || payloadLen > Wire.MAX_FRAGMENT_PAYLOAD) {
            throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        }
        val h = MediaHeader(getU16(b, 0), kind, b[3].toInt() and 0xFF, b[4].toInt() and 0xFF, getU32(b, 6), fragIdx, fragCnt, getU32(b, 14))
        return MediaPacket(h, b.copyOfRange(Wire.MEDIA_HEADER_LEN, b.size))
    }
}

/** One missing fragment, or with [Wire.ALL_FRAGMENTS] a whole frame. */
data class NackItem(val frameId: Long, val frag: Int)

object Control {
    fun encodeNack(src: Int, kind: Kind, items: List<NackItem>): ByteArray {
        val n = minOf(items.size, Wire.MAX_NACK_ITEMS)
        val out = ByteArray(4 + 6 * n)
        putU16(out, 0, src)
        out[2] = kind.id.toByte()
        out[3] = n.toByte()
        for (i in 0 until n) {
            putU32(out, 4 + 6 * i, items[i].frameId)
            putU16(out, 8 + 6 * i, items[i].frag)
        }
        return out
    }

    fun decodeNack(b: ByteArray): Triple<Int, Kind, List<NackItem>> {
        if (b.size < 4) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        val kind = Kind.of(b[2].toInt() and 0xFF)
        val n = b[3].toInt() and 0xFF
        if (kind == null || n > Wire.MAX_NACK_ITEMS || b.size < 4 + 6 * n) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        val items = List(n) { NackItem(getU32(b, 4 + 6 * it), getU16(b, 8 + 6 * it)) }
        return Triple(getU16(b, 0), kind, items)
    }

    fun encodeKeyframeReq(src: Int, kind: Kind): ByteArray = ByteArray(3).also { putU16(it, 0, src); it[2] = kind.id.toByte() }

    fun decodeKeyframeReq(b: ByteArray): Pair<Int, Kind> {
        val kind = if (b.size >= 3) Kind.of(b[2].toInt() and 0xFF) else null
        if (kind == null) throw UdpMediaException(UdpMediaException.Reason.MALFORMED)
        return getU16(b, 0) to kind
    }
}

/** 1024-packet sliding replay window (as in IPsec ESP). Only advance it after a packet authenticates. */
class ReplayWindow {
    private var init = false
    private var max = 0L
    private val bits = LongArray(16)

    /** Whether [seq] is unseen and inside (or ahead of) the window. Sequence numbers are treated as unsigned 63-bit. */
    fun ok(seq: Long): Boolean {
        if (!init || seq > max) return true
        if (max - seq >= SIZE) return false
        return bits[((seq % SIZE) / 64).toInt()] and (1L shl (seq % 64).toInt()) == 0L
    }

    /** Records [seq] as seen, sliding the window when it is the newest. */
    fun mark(seq: Long) {
        if (!init) {
            init = true
            max = seq
            set(seq)
            return
        }
        if (seq > max) {
            val gap = seq - max
            if (gap >= SIZE) bits.fill(0L) else for (s in max + 1..seq) clear(s)
            max = seq
        }
        set(seq)
    }

    private fun set(s: Long) { bits[((s % SIZE) / 64).toInt()] = bits[((s % SIZE) / 64).toInt()] or (1L shl (s % 64).toInt()) }
    private fun clear(s: Long) { bits[((s % SIZE) / 64).toInt()] = bits[((s % SIZE) / 64).toInt()] and (1L shl (s % 64).toInt()).inv() }

    private companion object { const val SIZE = 1024L }
}

internal fun putU16(b: ByteArray, off: Int, v: Int) { b[off] = (v ushr 8).toByte(); b[off + 1] = v.toByte() }
internal fun putU32(b: ByteArray, off: Int, v: Long) { for (i in 0 until 4) b[off + i] = (v ushr (24 - 8 * i)).toByte() }
internal fun getU16(b: ByteArray, off: Int): Int = ((b[off].toInt() and 0xFF) shl 8) or (b[off + 1].toInt() and 0xFF)
internal fun getU32(b: ByteArray, off: Int): Long {
    var v = 0L
    for (i in 0 until 4) v = (v shl 8) or (b[off + i].toLong() and 0xFF)
    return v
}
