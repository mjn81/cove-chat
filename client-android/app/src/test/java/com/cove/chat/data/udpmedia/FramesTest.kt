package com.cove.chat.data.udpmedia

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FramesTest {
    private fun frameData(n: Int, seed: Int) = ByteArray(n) { (it * 7 + seed).toByte() }

    /** Fragments frame [id] and pushes every packet whose index is in [only] (all when null). */
    private fun feed(r: Reassembler, id: Long, data: ByteArray, key: Boolean, now: Long, kind: Kind = Kind.VIDEO, only: Set<Int>? = null, reverse: Boolean = false): List<Frame> {
        val hdr = MediaHeader(kind = kind, codec = Codec.H264, flags = if (key) Flags.KEYFRAME else 0, frameId = id, ts = id * 33)
        var parts = Fragmenter.split(hdr, data)!!.mapIndexed { i, p -> i to p }
        if (reverse) parts = parts.reversed()
        val out = ArrayList<Frame>()
        for ((i, p) in parts) {
            if (only != null && i !in only) continue
            val mp = MediaCodec.decode(p)
            out += r.push(mp.header, mp.payload, now)
        }
        return out
    }

    @Test fun fragmentSizesAndLimits() {
        val parts = Fragmenter.split(MediaHeader(kind = Kind.VIDEO, codec = 3, frameId = 9), ByteArray(2500))!!
        assertEquals(3, parts.size)
        assertEquals(listOf(1100, 1100, 300), parts.map { it.size - Wire.MEDIA_HEADER_LEN })
        assertEquals(1, Fragmenter.split(MediaHeader(kind = Kind.AUDIO, codec = 1, frameId = 0), ByteArray(0))!!.size)
        assertEquals(64, Fragmenter.split(MediaHeader(kind = Kind.VIDEO, codec = 3, frameId = 0), ByteArray(64 * 1100))!!.size)
        assertNull(Fragmenter.split(MediaHeader(kind = Kind.VIDEO, codec = 3, frameId = 0), ByteArray(64 * 1100 + 1)))
    }

    @Test fun reassemblesInOrderAndReordered() {
        val r = Reassembler(requireKeyframe = true)
        val d0 = frameData(3000, 1)
        val d1 = frameData(2200, 2)
        val a = feed(r, 0, d0, true, 0, reverse = true)
        assertEquals(1, a.size)
        assertArrayEquals(d0, a[0].data)
        assertTrue(a[0].keyframe)
        val b = feed(r, 1, d1, false, 1)
        assertEquals(1, b.size)
        assertArrayEquals(d1, b[0].data)
        assertEquals(33L, b[0].ts)
    }

    @Test fun duplicatesAndStalePacketsAreIgnored() {
        val r = Reassembler(requireKeyframe = true)
        val d = frameData(2000, 3)
        assertEquals(1, feed(r, 5, d, true, 0).size)
        assertTrue(feed(r, 5, d, true, 1).isEmpty()) // already delivered
        assertTrue(feed(r, 3, d, true, 1).isEmpty()) // older than the next expected frame
    }

    @Test fun outOfOrderFramesAreHeldUntilTheGapFills() {
        val r = Reassembler(requireKeyframe = false)
        assertEquals(1, feed(r, 0, frameData(10, 0), false, 0, Kind.AUDIO).size)
        assertTrue(feed(r, 2, frameData(10, 2), false, 1, Kind.AUDIO).isEmpty())
        val out = feed(r, 1, frameData(10, 1), false, 2, Kind.AUDIO)
        assertEquals(listOf(1L, 2L), out.map { it.id })
    }

    @Test fun missingFragmentIsNackedThenRecovered() {
        val r = Reassembler(requireKeyframe = true)
        feed(r, 0, frameData(2500, 4), true, 0, only = setOf(0, 2))
        assertTrue(r.poll(10).nacks.isEmpty()) // reordering grace
        val first = r.poll(25)
        assertEquals(listOf(NackItem(0, 1)), first.nacks)
        assertTrue(r.poll(40).nacks.isEmpty()) // rate limited (40 ms)
        assertEquals(listOf(NackItem(0, 1)), r.poll(70).nacks)
        // The retransmission arrives.
        val hdr = MediaHeader(kind = Kind.VIDEO, codec = 3, flags = Flags.KEYFRAME, frameId = 0, fragIdx = 1, fragCnt = 3)
        val out = r.push(hdr, ByteArray(1100) { (it * 7 + 4 + 1100 * 7).toByte() }, 80)
        assertEquals(1, out.size)
        assertEquals(2500, out[0].data.size)
    }

    @Test fun whollyMissingFrameIsNackedAsAllFragments() {
        val r = Reassembler(requireKeyframe = false)
        feed(r, 0, frameData(10, 0), false, 0, Kind.AUDIO)
        feed(r, 2, frameData(10, 2), false, 5, Kind.AUDIO)
        assertEquals(listOf(NackItem(1, Wire.ALL_FRAGMENTS)), r.poll(30).nacks)
    }

    @Test fun hopelessGapIsSkippedAfterMaxLatencyAndAudioIsNotResynchronised() {
        val r = Reassembler(requireKeyframe = false)
        feed(r, 0, frameData(10, 0), false, 0, Kind.AUDIO)
        feed(r, 2, frameData(10, 2), false, 5, Kind.AUDIO)
        assertTrue(r.poll(200).frames.isEmpty())
        val p = r.poll(320)
        assertEquals(listOf(2L), p.frames.map { it.id })
        assertFalse(p.needKeyframe) // audio is concealed, not resynchronised
    }

    @Test fun videoGapDropsToKeyframeAndRequestsOneRateLimited() {
        val r = Reassembler(requireKeyframe = true)
        assertEquals(1, feed(r, 0, frameData(500, 0), true, 0).size)
        feed(r, 2, frameData(500, 2), false, 5) // frame 1 never arrives
        val p = r.poll(320)
        assertTrue("delta frame after a skipped reference must be dropped", p.frames.isEmpty())
        assertTrue(p.needKeyframe)
        assertFalse(r.poll(500).needKeyframe) // within 500 ms of the last request
        assertTrue(feed(r, 3, frameData(500, 3), false, 600).isEmpty()) // live stream, still undecodable
        assertTrue(r.poll(830).needKeyframe) // asks again: the first request may have been lost
        assertFalse(r.poll(2500).needKeyframe) // a stream that went silent is not nagged forever
        // A new keyframe resumes decoding.
        val out = feed(r, 4, frameData(500, 4), true, 2600)
        assertEquals(listOf(4L), out.map { it.id })
        assertTrue(out[0].keyframe)
    }

    @Test fun deltaFramesBeforeTheFirstKeyframeAreDropped() {
        val r = Reassembler(requireKeyframe = true)
        assertTrue(feed(r, 7, frameData(100, 0), false, 0).isEmpty())
        assertEquals(1, feed(r, 8, frameData(100, 1), true, 1).size)
        assertEquals(1, feed(r, 9, frameData(100, 2), false, 2).size)
    }

    @Test fun longOutageResynchronisesInsteadOfBufferingForever() {
        val r = Reassembler(requireKeyframe = true)
        feed(r, 0, frameData(100, 0), true, 0)
        assertTrue(feed(r, 1000, frameData(100, 1), false, 10).isEmpty()) // resync needs a keyframe
        assertEquals(0, r.pendingFrames)
        assertEquals(1, feed(r, 1001, frameData(100, 2), true, 20).size)
    }

    @Test fun frameIdWrapAround() {
        val r = Reassembler(requireKeyframe = false)
        val ids = listOf(0xFFFFFFFEL, 0xFFFFFFFFL, 0L, 1L)
        val got = ids.flatMap { feed(r, it, frameData(20, it.toInt()), false, 0, Kind.AUDIO) }
        assertEquals(ids, got.map { it.id })
    }

    @Test fun malformedFragmentHeaderIsIgnored() {
        val r = Reassembler(true)
        assertTrue(r.push(MediaHeader(kind = Kind.VIDEO, codec = 3, frameId = 0, fragIdx = 3, fragCnt = 2), ByteArray(1), 0).isEmpty())
        assertTrue(r.push(MediaHeader(kind = Kind.VIDEO, codec = 3, frameId = 0, fragIdx = 0, fragCnt = 65), ByteArray(1), 0).isEmpty())
    }
}
