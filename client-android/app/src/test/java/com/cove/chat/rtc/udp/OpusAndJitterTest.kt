package com.cove.chat.rtc.udp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class OpusAndJitterTest {
    private fun sine(frame: Int, freq: Double = 440.0, amp: Double = 8000.0) = ShortArray(OpusFormat.FRAME_SAMPLES) {
        val t = (frame * OpusFormat.FRAME_SAMPLES + it) / OpusFormat.SAMPLE_RATE.toDouble()
        (amp * sin(2 * PI * freq * t)).toInt().toShort()
    }

    private fun rms(a: ShortArray): Double = SpeakingTracker.level(a, a.size) * 32768

    @Test fun roundTripPreservesATone() {
        val enc = OpusFrameEncoder()
        val dec = OpusFrameDecoder()
        val out = ShortArray(OpusFormat.FRAME_SAMPLES)
        var lastRms = 0.0
        repeat(25) { f ->
            val pkt = enc.encode(sine(f))
            assertTrue("packet fits one datagram", pkt.size in 1..400)
            assertEquals(OpusFormat.FRAME_SAMPLES, dec.decode(pkt, out))
            lastRms = rms(out)
        }
        // A sine of amplitude 8000 has RMS ~5657; after the codec's start-up the decoded level must be close.
        assertTrue("decoded tone level $lastRms", lastRms in 4500.0..6800.0)
    }

    @Test fun silenceIsCompressedByDtx() {
        val enc = OpusFrameEncoder()
        val silence = ShortArray(OpusFormat.FRAME_SAMPLES)
        val sizes = List(60) { enc.encode(silence).size }
        // DTX sends a short refresh packet now and then, so judge the bulk, not every packet.
        assertTrue("DTX should collapse silence to a few bytes, got ${sizes.takeLast(20)}", sizes.takeLast(20).count { it <= 3 } >= 16)
    }

    @Test fun lostFrameIsRebuiltFromTheNextPacketsFec() {
        val enc = OpusFrameEncoder()
        enc.setExpectedLossPercent(25)
        val pkts = List(30) { enc.encode(sine(it)) }
        val dec = OpusFrameDecoder()
        val out = ShortArray(OpusFormat.FRAME_SAMPLES)
        for (i in 0 until 20) dec.decode(pkts[i], out)
        // Frame 20 is lost; packet 21 carries redundancy for it.
        val n = dec.decodeLostFrom(pkts[21], out)
        assertEquals(OpusFormat.FRAME_SAMPLES, n)
        assertTrue("FEC output should carry the tone, rms=${rms(out)}", rms(out) > 2000)
        assertEquals(OpusFormat.FRAME_SAMPLES, dec.decode(pkts[21], out))
    }

    @Test fun concealmentProducesAFullFrameAndEmptyPacketsAreConcealed() {
        val dec = OpusFrameDecoder()
        val out = ShortArray(OpusFormat.FRAME_SAMPLES)
        dec.decode(OpusFrameEncoder().encode(sine(0)), out)
        assertEquals(OpusFormat.FRAME_SAMPLES, dec.conceal(out))
        assertEquals(OpusFormat.FRAME_SAMPLES, dec.decode(ByteArray(0), out))
        assertEquals(OpusFormat.FRAME_SAMPLES, dec.decode(ByteArray(OpusFormat.MAX_PACKET + 1), out)) // oversized input never reaches the codec
    }

    @Test fun garbageDoesNotCrashTheDecoder() {
        val dec = OpusFrameDecoder()
        val out = ShortArray(OpusFormat.FRAME_SAMPLES)
        val rnd = java.util.Random(7)
        repeat(200) {
            val junk = ByteArray(1 + rnd.nextInt(200)).also { rnd.nextBytes(it) }
            try { dec.decode(junk, out) } catch (_: io.github.jaredmdobson.concentus.OpusException) { /* rejected cleanly */ }
        }
        assertNotNull(dec)
    }

    // ── jitter buffer ──

    private fun p(i: Int) = byteArrayOf(i.toByte())

    @Test fun waitsForTargetDepthThenPlaysInOrder() {
        val j = AudioJitterBuffer(targetPackets = 3)
        j.push(10, p(10)); j.push(11, p(11))
        assertTrue(j.pull() is PlayoutStep.Silence)
        j.push(12, p(12))
        val ids = List(3) { (j.pull() as PlayoutStep.Packet).id }
        assertEquals(listOf(10L, 11L, 12L), ids)
    }

    @Test fun reordersWithinTheBuffer() {
        val j = AudioJitterBuffer(3)
        j.push(2, p(2)); j.push(0, p(0)); j.push(1, p(1))
        assertEquals(listOf(0L, 1L, 2L), List(3) { (j.pull() as PlayoutStep.Packet).id })
    }

    @Test fun lostFrameWithAFollowerIsRecoveredViaFecThenFollowerPlays() {
        val j = AudioJitterBuffer(3)
        j.push(0, p(0)); j.push(2, p(2)); j.push(3, p(3)); j.push(4, p(4))
        assertEquals(0L, (j.pull() as PlayoutStep.Packet).id)
        val rec = j.pull()
        assertTrue(rec is PlayoutStep.Recover)
        assertEquals(2, (rec as PlayoutStep.Recover).nextData[0].toInt())
        assertEquals(2L, (j.pull() as PlayoutStep.Packet).id)
    }

    @Test fun twoLostFramesConcealTheSecondOne() {
        val j = AudioJitterBuffer(3)
        j.push(0, p(0)); j.push(3, p(3)); j.push(4, p(4))
        j.pull()
        assertTrue(j.pull() is PlayoutStep.Conceal) // 1: nothing at 2 either
        assertTrue(j.pull() is PlayoutStep.Recover) // 2: frame 3 carries FEC for it
        assertEquals(3L, (j.pull() as PlayoutStep.Packet).id)
    }

    @Test fun underrunRebuffersInsteadOfStuttering() {
        val j = AudioJitterBuffer(3)
        listOf(0, 1, 2).forEach { j.push(it.toLong(), p(it)) }
        repeat(3) { j.pull() }
        assertTrue(j.pull() is PlayoutStep.Silence)
        j.push(3, p(3)); j.push(4, p(4))
        assertTrue("still filling", j.pull() is PlayoutStep.Silence)
        j.push(5, p(5))
        assertEquals(3L, (j.pull() as PlayoutStep.Packet).id)
    }

    @Test fun lateAndDuplicateFramesAreIgnoredOnceTheyHavePlayed() {
        val j = AudioJitterBuffer(2)
        j.push(0, p(0)); j.push(1, p(1)); j.push(2, p(2))
        j.pull(); j.pull()
        j.push(0, p(0)); j.push(1, p(1))
        assertEquals(2L, (j.pull() as PlayoutStep.Packet).id)
        assertEquals(0, j.size)
    }

    @Test fun burstIsTrimmedSoLatencyCannotCreepUp() {
        val j = AudioJitterBuffer(3, maxPackets = 5)
        repeat(20) { j.push(it.toLong(), p(it)) }
        assertEquals(5, j.size)
        assertEquals(15L, (j.pull() as PlayoutStep.Packet).id)
    }

    @Test fun longOutageSkipsAheadInsteadOfConcealingTheWholeGap() {
        val j = AudioJitterBuffer(2)
        j.push(0, p(0)); j.push(1, p(1)); j.pull(); j.pull()
        j.push(500, p(1)); j.push(501, p(1)); j.push(502, p(1))
        assertEquals(500L, (j.pull() as PlayoutStep.Packet).id)
    }

    @Test fun roundTripWithLossReorderAndRealOpusKeepsAudioFlowing() {
        // DTX off: a steady synthetic tone is not speech, so a DTX encoder would (correctly) stop sending it.
        val enc = OpusFrameEncoder(dtx = false).also { it.setExpectedLossPercent(20) }
        val dec = OpusFrameDecoder()
        val jb = AudioJitterBuffer(3)
        val pcm = ShortArray(OpusFormat.FRAME_SAMPLES)
        var played = 0
        var energetic = 0
        for (f in 0 until 100) {
            val data = enc.encode(sine(f))
            if (f % 7 != 3) jb.push(f.toLong(), data) // every 7th-ish frame lost on the wire
            when (val step = jb.pull()) {
                is PlayoutStep.Packet -> { dec.decode(step.data, pcm); played++; if (rms(pcm) > 1500) energetic++ }
                is PlayoutStep.Recover -> { dec.decodeLostFrom(step.nextData, pcm); played++; if (rms(pcm) > 1000) energetic++ }
                PlayoutStep.Conceal -> { dec.conceal(pcm); played++ }
                PlayoutStep.Silence -> {}
            }
        }
        assertTrue("played $played", played > 85)
        assertTrue("only $energetic of $played frames carried audio", energetic > played * 0.8)
    }
}
