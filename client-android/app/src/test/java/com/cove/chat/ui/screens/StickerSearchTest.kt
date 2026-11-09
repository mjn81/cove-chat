package com.cove.chat.ui.screens

import com.cove.chat.data.model.PackItem
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StickerSearchTest {
    private val rocket = PackItem(id = "rocket", name = "Rocket Launch", emoji = "\uD83D\uDE80")

    @Test fun emptyQueryKeepsEverything() { assertTrue(matchesSticker(rocket, "  ")) }

    @Test fun matchesNameIdAndEmoji() {
        assertTrue(matchesSticker(rocket, "launch"))
        assertTrue(matchesSticker(rocket, "ROCK"))
        assertTrue(matchesSticker(rocket, "\uD83D\uDE80"))
        assertFalse(matchesSticker(rocket, "cat"))
    }
}
