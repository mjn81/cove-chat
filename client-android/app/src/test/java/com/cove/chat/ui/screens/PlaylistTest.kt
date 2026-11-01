package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaylistTest {
    private val ids = listOf("a", "b", "c")

    @Test
    fun returnsTheNextAndPreviousTrack() {
        assertEquals("c", neighbourId(ids, "b", 1))
        assertEquals("a", neighbourId(ids, "b", -1))
    }

    @Test
    fun stopsAtBothEndsInsteadOfWrapping() {
        assertNull(neighbourId(ids, "c", 1))
        assertNull(neighbourId(ids, "a", -1))
    }

    @Test
    fun findsNothingWhenTheCurrentTrackIsNotQueued() {
        assertNull(neighbourId(ids, "zzz", 1))
        assertNull(neighbourId(emptyList(), "a", 1))
    }

    @Test
    fun recordedNotesShowTheSenderAndMusicKeepsItsName() {
        assertEquals("mjn", playlistLabel(isVoice = true, fileName = "voice-message.m4a", sender = "mjn"))
        assertEquals("Song.mp3", playlistLabel(isVoice = false, fileName = "Song.mp3", sender = "mjn"))
        assertEquals("sara", playlistLabel(isVoice = false, fileName = "voice-message.webm", sender = "sara"))
    }
}
