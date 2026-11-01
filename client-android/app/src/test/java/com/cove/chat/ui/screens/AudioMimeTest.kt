package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioMimeTest {
    @Test
    fun keepsAnAudioMimeTheSystemReported() {
        assertEquals("audio/mpeg", resolveMime("audio/mpeg", "song.mp3"))
    }

    @Test
    fun fillsInTheMimeFromTheExtensionWhenTheSystemGivesNone() {
        assertEquals("audio/mpeg", resolveMime(null, "Song.MP3"))
        assertEquals("audio/mp4", resolveMime("application/octet-stream", "track.m4a"))
        assertEquals("audio/flac", resolveMime(null, "a.flac"))
        assertEquals("audio/ogg", resolveMime("application/octet-stream", "a.opus"))
        assertEquals("audio/aac", resolveMime(null, "a.aac"))
        assertEquals("audio/wav", resolveMime(null, "a.wav"))
        assertEquals("audio/amr", resolveMime(null, "a.amr"))
        assertEquals("audio/x-ms-wma", resolveMime(null, "a.wma"))
    }

    @Test
    fun normalisesLegacyAudioAliases() {
        assertEquals("audio/mpeg", resolveMime("audio/mp3", "a.mp3"))
        assertEquals("audio/wav", resolveMime("audio/x-wav", "a.wav"))
        assertEquals("audio/mp4", resolveMime("audio/x-m4a", "a.m4a"))
    }

    @Test
    fun leavesNonAudioAlone() {
        assertEquals("application/pdf", resolveMime("application/pdf", "a.pdf"))
        assertEquals("application/octet-stream", resolveMime(null, "archive.zip"))
        assertEquals("video/mp4", resolveMime("video/mp4", "clip.mp4"))
    }

    @Test
    fun onlyAudioMimesAreSentInline() {
        assertTrue(isInlineAudio("audio/flac"))
        assertFalse(isInlineAudio("video/mp4"))
        assertFalse(isInlineAudio("application/octet-stream"))
    }
}
