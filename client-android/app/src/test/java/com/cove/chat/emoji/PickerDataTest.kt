package com.cove.chat.emoji

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PickerDataTest {
    private val sample = """{"categories":[{"id":"people","emojis":[["😀","grinning face","smile happy",[]],["👍","thumbs up","like yes",["👍🏻","👍🏼","👍🏽","👍🏾","👍🏿"]]]},{"id":"nature","emojis":[["🐶","dog face","pet puppy",[]]]}]}"""

    @Test fun parsesCategoriesAndSkins() {
        val c = PickerData.parse(sample)
        assertEquals(listOf("people", "nature"), c.map { it.id })
        val thumbs = c[0].emojis[1]
        assertEquals("👍🏽", thumbs.forTone(4))
        assertEquals("👍", thumbs.forTone(1))
        assertEquals("😀", c[0].emojis[0].forTone(5)) // no variants: keeps its only form
    }

    @Test fun searchRanksNamePrefixFirstAndNeedsAllWords() {
        val c = PickerData.parse(sample)
        assertEquals(listOf("🐶"), PickerData.search(c, "dog").map { it.native })
        assertEquals(listOf("🐶"), PickerData.search(c, "pet dog").map { it.native })
        assertTrue(PickerData.search(c, "dog cat").isEmpty())
        assertEquals("👍", PickerData.search(c, "like").first().native)
        assertTrue(PickerData.search(c, "  ").isEmpty())
    }

    @Test fun recentsKeepSingleEmojiAndShortcodesOnly() {
        var r = emptyList<String>()
        r = PickerData.addRecent(r, "😀")
        r = PickerData.addRecent(r, "hello")
        r = PickerData.addRecent(r, "😀😀")
        r = PickerData.addRecent(r, ":party:")
        r = PickerData.addRecent(r, "👍")
        r = PickerData.addRecent(r, "😀")
        assertEquals(listOf("😀", "👍", ":party:"), r)
        assertEquals(32, (1..40).fold(emptyList<String>()) { acc, i -> PickerData.addRecent(acc, String(Character.toChars(0x1F600 + i))) }.size)
    }

    @Test fun shippedAssetParses() {
        val f = File("src/main/assets/emoji/picker.json")
        if (!f.exists()) return
        val c = PickerData.parse(f.readText())
        assertEquals(8, c.size)
        assertTrue(c.sumOf { it.emojis.size } > 1500)
    }
}
