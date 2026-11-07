package com.cove.chat.rtc.udp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream

class H264SpsAndPoliciesTest {
    /** Minimal bit writer so SPS fixtures are built from the spec's syntax rather than copied bytes. */
    private class BitWriter {
        private val out = ByteArrayOutputStream()
        private var cur = 0
        private var n = 0
        fun bit(b: Int) { cur = (cur shl 1) or (b and 1); if (++n == 8) { out.write(cur); cur = 0; n = 0 } }
        fun bits(v: Int, count: Int) { for (i in count - 1 downTo 0) bit((v shr i) and 1) }
        fun ue(v: Int) { val x = v + 1; val len = 32 - Integer.numberOfLeadingZeros(x); bits(0, len - 1); bits(x, len) }
        fun finish(): ByteArray { bit(1); while (n != 0) bit(0); return out.toByteArray() }
    }

    /** Builds an Annex-B SPS (start code + NAL header + escaped RBSP). */
    private fun sps(profile: Int, widthMbs: Int, heightMbs: Int, cropBottom: Int = 0, cropRight: Int = 0, high: Boolean = profile >= 100): ByteArray {
        val w = BitWriter()
        w.bits(profile, 8); w.bits(0xC0, 8); w.bits(31, 8)
        w.ue(0)
        if (high) { w.ue(1); w.ue(0); w.ue(0); w.bit(0); w.bit(0) }
        w.ue(0) // log2_max_frame_num_minus4
        w.ue(2) // pic_order_cnt_type 2
        w.ue(1) // max_num_ref_frames
        w.bit(0)
        w.ue(widthMbs - 1); w.ue(heightMbs - 1)
        w.bit(1) // frame_mbs_only
        w.bit(1) // direct_8x8
        if (cropBottom + cropRight > 0) { w.bit(1); w.ue(0); w.ue(cropRight); w.ue(0); w.ue(cropBottom) } else w.bit(0)
        w.bit(0) // vui
        val rbsp = w.finish()
        val esc = ByteArrayOutputStream()
        var zeros = 0
        for (b in rbsp) {
            val v = b.toInt() and 0xFF
            if (zeros >= 2 && v <= 3) { esc.write(3); zeros = 0 }
            esc.write(v); zeros = if (v == 0) zeros + 1 else 0
        }
        return byteArrayOf(0, 0, 0, 1, 0x67) + esc.toByteArray()
    }

    @Test fun constrainedBaselineSizes() {
        val s = H264Sps.size(sps(66, 40, 30))!!
        assertEquals(640, s.width); assertEquals(480, s.height)
        val r = H264Sps.size(sps(66, 80, 45))!!
        assertEquals(1280, r.width); assertEquals(720, r.height)
    }

    @Test fun croppingIsApplied() {
        // 1080p is coded as 1920x1088 with 8 lines cropped (4 crop units of 2 lines in 4:2:0).
        val s = H264Sps.size(sps(100, 120, 68, cropBottom = 4))!!
        assertEquals(1920, s.width); assertEquals(1080, s.height)
        val c = H264Sps.size(sps(66, 41, 30, cropRight = 4))!! // 656 - 8
        assertEquals(648, c.width)
    }

    @Test fun findsTheSpsInsideAFullAccessUnitAndIdrDetection() {
        val sps = sps(66, 20, 15)
        val pps = byteArrayOf(0, 0, 0, 1, 0x68, 0xCE.toByte(), 0x3C, 0x80.toByte())
        val idr = byteArrayOf(0, 0, 1, 0x65, 0x88.toByte(), 0x84.toByte(), 0, 0, 3, 1)
        val au = sps + pps + idr
        assertEquals(320, H264Sps.size(au)!!.width)
        assertEquals(listOf(7, 8, 5), H264Sps.nalTypes(au))
        assertTrue(H264Sps.containsIdr(au))
        assertFalse(H264Sps.containsIdr(byteArrayOf(0, 0, 1, 0x41, 1, 2, 3)))
    }

    @Test fun missingOrBrokenSpsGivesNull() {
        assertNull(H264Sps.size(byteArrayOf(0, 0, 1, 0x65, 1, 2)))
        assertNull(H264Sps.size(byteArrayOf(0, 0, 0, 1, 0x67, 0x42)))
        assertNull(H264Sps.size(ByteArray(0)))
    }

    /** The widely-seen x264 1080p High-profile SPS, as a third-party fixture. */
    @Test fun realWorldHighProfileSps() {
        val bytes = "6764002 8acd940780227e5c044000003000400000300f03c60c658".replace(" ", "")
        val b = ByteArray(bytes.length / 2) { bytes.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        val s = H264Sps.size(byteArrayOf(0, 0, 0, 1) + b)!!
        assertEquals(1920, s.width); assertEquals(1080, s.height)
    }

    // ── policies ──

    @Test fun backoffStepsDownOnLossAndRecoversAfterCalmWindows() {
        val c = BackoffController(maxLevel = 3, stepDownAt = 3, calmWindowsToRecover = 3)
        assertEquals(0, c.sample(1)) // below threshold
        assertEquals(1, c.sample(3))
        assertEquals(2, c.sample(5))
        assertEquals(3, c.sample(9))
        assertEquals(3, c.sample(9)) // capped
        assertEquals(3, c.sample(0)); assertEquals(3, c.sample(0))
        assertEquals(2, c.sample(0)) // third calm window
        assertEquals(2, c.sample(1)) // a little noise resets the calm counter
        repeat(2) { c.sample(0) }
        assertEquals(1, c.sample(0))
    }

    @Test fun backoffLevelsScaleBitrateAndFps() {
        assertEquals(1_000_000, BackoffController.bitrateFor(1_000_000, 0))
        assertEquals(200_000, BackoffController.bitrateFor(1_000_000, 3))
        assertEquals(15, BackoffController.fpsFor(30, 3))
        assertEquals(5, BackoffController.fpsFor(8, 3)) // never below 5
        assertEquals(2.0, BackoffController.scaleFor(3), 0.0)
    }

    @Test fun keyframeLimiterAllowsOnePerInterval() {
        val k = KeyframeLimiter(500)
        assertTrue(k.allow(0)); assertFalse(k.allow(100)); assertFalse(k.allow(499)); assertTrue(k.allow(500))
    }

    @Test fun mediaDirectoryReplacesStaleMappings() {
        val d = MediaDirectory()
        d.put(1, "alice"); d.put(2, "bob")
        assertEquals("bob", d.userOf(2)); assertEquals(1, d.mediaOf("alice"))
        d.put(3, "alice") // alice rejoined with a new id
        assertNull(d.userOf(1)); assertEquals("alice", d.userOf(3))
        d.put(2, "carol") // id reused by someone else
        assertNull(d.mediaOf("bob"))
        d.remove("carol"); assertNull(d.userOf(2))
    }

    @Test fun speakingTrackerHangsThenClears() {
        val t = SpeakingTracker(hangTicks = 2)
        assertEquals(setOf("a"), t.tick(setOf("a")))
        assertEquals(setOf("a"), t.tick(emptySet()))
        assertEquals(emptySet<String>(), t.tick(emptySet()))
    }

    @Test fun pcmLevelIsRms() {
        assertEquals(0.0, SpeakingTracker.level(ShortArray(10), 10), 0.0)
        assertEquals(0.5, SpeakingTracker.level(ShortArray(4) { 16384 }, 4), 1e-9)
        assertEquals(0.0, SpeakingTracker.level(ShortArray(0), 0), 0.0)
    }
}
