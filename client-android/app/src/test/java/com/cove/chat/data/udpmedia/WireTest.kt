package com.cove.chat.data.udpmedia

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WireTest {
    @Test fun mediaHeaderLayoutIsExact() {
        val h = MediaHeader(src = 0x0102, kind = Kind.VIDEO, codec = Codec.H264, flags = Flags.KEYFRAME, frameId = 0xAABBCCDDL, fragIdx = 2, fragCnt = 5, ts = 0x01020304L)
        val b = MediaCodec.encode(h, byteArrayOf(9, 8, 7))
        assertEquals("010202030100" + "aabbccdd" + "0002" + "0005" + "01020304" + "090807", b.toHex())
        val back = MediaCodec.decode(b)
        assertEquals(h, back.header)
        assertArrayEquals(byteArrayOf(9, 8, 7), back.payload)
        assertTrue(back.header.keyframe)
    }

    @Test fun mediaDecodeValidates() {
        val ok = MediaHeader(kind = Kind.AUDIO, codec = 1, frameId = 1)
        fun enc(h: MediaHeader, n: Int = 1) = MediaCodec.encode(h, ByteArray(n))
        assertThrows(UdpMediaException::class.java) { MediaCodec.decode(ByteArray(17)) }
        assertThrows(UdpMediaException::class.java) { MediaCodec.decode(enc(ok).also { it[2] = 9 }) }
        assertThrows(UdpMediaException::class.java) { MediaCodec.decode(enc(ok.copy(fragCnt = 0))) }
        assertThrows(UdpMediaException::class.java) { MediaCodec.decode(enc(ok.copy(fragCnt = 65))) }
        assertThrows(UdpMediaException::class.java) { MediaCodec.decode(enc(ok.copy(fragIdx = 1, fragCnt = 1))) }
        assertThrows(UdpMediaException::class.java) { MediaCodec.decode(enc(ok, 1101)) }
        MediaCodec.decode(enc(ok, 1100))
    }

    @Test fun nackRoundTripAndLimits() {
        val items = listOf(NackItem(5, 0), NackItem(0xFFFFFFFFL, Wire.ALL_FRAGMENTS))
        val b = Control.encodeNack(7, Kind.SCREEN, items)
        assertEquals("0007" + "03" + "02" + "00000005" + "0000" + "ffffffff" + "ffff", b.toHex())
        val (src, kind, back) = Control.decodeNack(b)
        assertEquals(7, src)
        assertEquals(Kind.SCREEN, kind)
        assertEquals(items, back)
        assertEquals(32, Control.decodeNack(Control.encodeNack(1, Kind.VIDEO, List(40) { NackItem(it.toLong(), 0) })).third.size)
        assertThrows(UdpMediaException::class.java) { Control.decodeNack(b.copyOf(6)) }
        assertThrows(UdpMediaException::class.java) { Control.decodeNack(b.copyOf().also { it[2] = 0 }) }
    }

    @Test fun keyframeReqRoundTrip() {
        val b = Control.encodeKeyframeReq(0x1234, Kind.VIDEO)
        assertEquals("123402", b.toHex())
        assertEquals(0x1234 to Kind.VIDEO, Control.decodeKeyframeReq(b))
        assertThrows(UdpMediaException::class.java) { Control.decodeKeyframeReq(byteArrayOf(0, 1)) }
    }

    @Test fun replayWindowSemantics() {
        val w = ReplayWindow()
        assertTrue(w.ok(0))
        w.mark(0)
        assertFalse(w.ok(0))
        w.mark(5000)
        assertFalse(w.ok(5000))
        assertFalse(w.ok(3000)) // older than the window
        assertTrue(w.ok(4500))
        w.mark(4500)
        assertFalse(w.ok(4500))
        assertTrue(w.ok(5001))
        w.mark(5000 + 1024) // sliding clears recycled slots
        assertTrue(w.ok(5000 + 1024 - 1))
    }
}
