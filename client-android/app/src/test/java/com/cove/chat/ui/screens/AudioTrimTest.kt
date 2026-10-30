package com.cove.chat.ui.screens

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioTrimTest {
    @Test
    fun minGapIsOneSecondOfTheRecording() {
        assertEquals(0.1f, AudioTrim.minGapFraction(10_000), 1e-6f)
        assertEquals(1f, AudioTrim.minGapFraction(500), 1e-6f)
        assertEquals(1f, AudioTrim.minGapFraction(0), 1e-6f)
    }

    @Test
    fun startHandleCannotCrossTheEndHandleOrLeaveTheRecording() {
        val gap = 0.1f
        assertEquals(0.7f, AudioTrim.moveStart(0.95f, end = 0.8f, minGap = gap), 1e-6f)
        assertEquals(0f, AudioTrim.moveStart(-0.3f, end = 0.8f, minGap = gap), 1e-6f)
        assertEquals(0.4f, AudioTrim.moveStart(0.4f, end = 0.8f, minGap = gap), 1e-6f)
    }

    @Test
    fun endHandleCannotCrossTheStartHandleOrLeaveTheRecording() {
        val gap = 0.1f
        assertEquals(0.3f, AudioTrim.moveEnd(0.05f, start = 0.2f, minGap = gap), 1e-6f)
        assertEquals(1f, AudioTrim.moveEnd(1.4f, start = 0.2f, minGap = gap), 1e-6f)
        assertEquals(0.6f, AudioTrim.moveEnd(0.6f, start = 0.2f, minGap = gap), 1e-6f)
    }

    @Test
    fun fullRangeSendsTheOriginal() {
        assertTrue(AudioTrim.isFullRange(0f, 1f))
        assertTrue(AudioTrim.isFullRange(0.002f, 0.998f))
        assertFalse(AudioTrim.isFullRange(0.1f, 1f))
        assertFalse(AudioTrim.isFullRange(0f, 0.9f))
    }

    @Test
    fun trimmedLengthIsRoundedAndNeverBelowOneSecond() {
        assertEquals(5, AudioTrim.trimmedSeconds(10_000, 0f, 0.5f))
        assertEquals(1, AudioTrim.trimmedSeconds(10_000, 0.45f, 0.5f))
        assertEquals(8, AudioTrim.trimmedSeconds(10_400, 0.1f, 0.9f))
    }

    @Test
    fun slicedWaveformKeepsFullWidthAndTheLoudestValues() {
        val peaks = ByteArray(60) { it.toByte() } // rising 0..59
        val sliced = AudioTrim.slicePeaks(peaks, 0.5f, 1f)
        assertEquals(60, sliced.size)
        assertEquals(59, sliced.last().toInt())
        assertTrue("the slice must start at the cut, not at zero", sliced.first() >= 30)
    }

    @Test
    fun slicingTheWholeRangeKeepsTheWaveform() {
        val peaks = ByteArray(60) { (it % 7 * 10).toByte() }
        assertArrayEquals(peaks, AudioTrim.slicePeaks(peaks, 0f, 1f))
    }

    @Test
    fun emptyWaveformStaysEmpty() {
        assertEquals(0, AudioTrim.slicePeaks(ByteArray(0), 0f, 1f).size)
    }
}
