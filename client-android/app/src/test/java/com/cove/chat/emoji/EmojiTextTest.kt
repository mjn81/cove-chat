package com.cove.chat.emoji

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmojiTextTest {
    private fun emojis(text: String, names: Set<String> = emptySet()) =
        EmojiText.tokenize(text, names).filterIsInstance<EmojiToken.Emoji>().map { it.value }

    @Test fun keyDropsVariationSelectorAndJoinsHex() {
        assertEquals("2764", EmojiText.key("❤️"))
        assertEquals("1f44d-1f3fd", EmojiText.key("👍🏽"))
        assertEquals("1f1e9-1f1ea", EmojiText.key("🇩🇪"))
        assertEquals("1f468-200d-1f469-200d-1f467", EmojiText.key("👨‍👩‍👧"))
    }

    @Test fun plainTextHasNoEmoji() {
        assertTrue(emojis("hello 123 #5 © abc").isEmpty())
        assertEquals(listOf(EmojiToken.Text("hello 123 #5 © abc")), EmojiText.tokenize("hello 123 #5 © abc"))
    }

    @Test fun skinToneFlagAndZwjStayOneEmoji() {
        assertEquals(listOf("👍🏽"), emojis("👍🏽"))
        assertEquals(listOf("🇩🇪"), emojis("🇩🇪"))
        val family = "👨‍👩‍👧"
        assertEquals(listOf(family), emojis(family))
        val manTech = "👨🏽‍💻"
        assertEquals(listOf(manTech), emojis(manTech))
        val manGender = "🧙‍♂️" // mage + male sign (text-default joiner)
        assertEquals(listOf(manGender), emojis(manGender))
    }

    @Test fun keycapsAndTextDefaultSymbolsNeedTheirMarker() {
        assertEquals(listOf("1️⃣"), emojis("1️⃣"))
        assertEquals(listOf("#⃣"), emojis("#⃣"))
        assertTrue(emojis("1 # *").isEmpty())
        assertEquals(listOf("©️"), emojis("©️"))
        assertEquals(listOf("❤️"), emojis("❤️"))
        assertEquals(listOf("❤️‍🔥"), emojis("❤️‍🔥"))
    }

    @Test fun tokensConcatenateBackToTheText() {
        val text = "hi 😀 there 👍🏽! :party: end"
        val tokens = EmojiText.tokenize(text, setOf("party"))
        val rebuilt = tokens.joinToString("") { when (it) { is EmojiToken.Text -> it.value; is EmojiToken.Emoji -> it.value; is EmojiToken.Custom -> it.value } }
        assertEquals(text, rebuilt)
        assertTrue(tokens.any { it is EmojiToken.Custom && it.name == "party" })
    }

    @Test fun unknownShortcodeStaysTextAndNextOneIsStillFound() {
        val tokens = EmojiText.tokenize(":nope:aa:", setOf("aa"))
        assertEquals(listOf(EmojiToken.Text(":nope"), EmojiToken.Custom(":aa:", "aa")), tokens.filter { it !is EmojiToken.Text || it.value.isNotEmpty() }.let { it })
    }

    @Test fun invalidNamesAreNotShortcodes() {
        assertEquals(listOf<EmojiToken>(EmojiToken.Text(":A:")), EmojiText.tokenize(":A:", setOf("A")))
        assertEquals(listOf<EmojiToken>(EmojiToken.Text(":a:")), EmojiText.tokenize(":a:", setOf("a")))
    }

    @Test fun oneEmojiWithAnimationIsAnimated() {
        val rocket = "🚀"
        val c = EmojiText.classify(" $rocket ", { it == "1f680" })
        assertEquals(EmojiMessageClass.Animated("1f680", rocket), c)
    }

    @Test fun oneEmojiWithoutAnimationAndTwoOrThreeAreJumbo() {
        val smile = "😀"
        assertEquals(EmojiMessageClass.Jumbo(1), EmojiText.classify(smile))
        assertEquals(EmojiMessageClass.Jumbo(2), EmojiText.classify("$smile $smile", { true }))
        assertEquals(EmojiMessageClass.Jumbo(3), EmojiText.classify("$smile$smile$smile", { true }))
    }

    @Test fun fourOrMoreOrOtherTextIsNormal() {
        val smile = "😀"
        assertEquals(EmojiMessageClass.Normal, EmojiText.classify(smile.repeat(4)))
        assertEquals(EmojiMessageClass.Normal, EmojiText.classify("hi $smile"))
        assertEquals(EmojiMessageClass.Normal, EmojiText.classify(""))
        assertEquals(EmojiMessageClass.Normal, EmojiText.classify("x".repeat(200)))
    }

    @Test fun customEmojiCountsAsJumboNeverAnimated() {
        assertEquals(EmojiMessageClass.Jumbo(1), EmojiText.classify(":party:", { true }, setOf("party")))
        assertEquals(EmojiMessageClass.Jumbo(2), EmojiText.classify(":party: 😀", { true }, setOf("party")))
        assertEquals(EmojiMessageClass.Normal, EmojiText.classify(":party:", { true }))
    }

    @Test fun layoutRules() {
        assertEquals(64, EmojiText.jumboDp(1)); assertEquals(52, EmojiText.jumboDp(2)); assertEquals(44, EmojiText.jumboDp(3))
        assertEquals(9, EmojiText.pickerColumns(0f)); assertEquals(5, EmojiText.pickerColumns(100f)); assertEquals(8, EmojiText.pickerColumns(330f))
        assertEquals(12, EmojiText.pickerColumns(900f))
        assertEquals(4, EmojiText.stickerColumns(0f)); assertEquals(3, EmojiText.stickerColumns(200f)); assertEquals(6, EmojiText.stickerColumns(900f))
    }

    @Test fun normalizeAndValidateNames() {
        assertEquals("party_parrot", EmojiText.normalizeName(":Party Parrot:"))
        assertTrue(EmojiText.isValidName("ab")); assertTrue(!EmojiText.isValidName("a")); assertTrue(!EmojiText.isValidName("A_b"))
    }

    @Test fun firstEmojiPicksTheFirst() {
        assertEquals("😀", EmojiText.firstEmoji("ab😀👍"))
        assertEquals("", EmojiText.firstEmoji("abc"))
    }
}
