package com.cove.chat.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MentionUnicodeTest {
    // "й" written as "и" + combining breve (U+0306), as some keyboards and macOS file names produce it.
    private val decomposed = "Андрей"

    private fun mentions(text: String) = tokenizeMessage(text).filterIsInstance<MessageToken.Mention>().map { it.value }

    private fun hasMention(nodes: List<MdInline>) = nodes.toString().contains("Mention(")

    @Test fun cyrillicMentionIsOneToken() {
        assertEquals(listOf("@Иван"), mentions("привет @Иван!"))
        assertEquals(listOf("@Алёна_2"), mentions("@Алёна_2, привет"))
        assertEquals(listOf("@$decomposed"), mentions("@$decomposed тут"))
        assertEquals(MessageToken.Mention("@Иван") to 5, matchAutoLinkAt("@Иван тут", 0))
    }

    @Test fun atSignInsideAWordIsNotAMention() {
        assertEquals(emptyList<String>(), mentions("почта@иван"))
        assertEquals(emptyList<String>(), mentions("$decomposed@иван"))
        assertEquals(listOf<MessageToken>(MessageToken.Plain("почта@иван")), tokenizeMessage("почта@иван"))
    }

    @Test fun markdownKeepsTheSameWordBoundaries() {
        assertTrue(hasMention(parseInline("привет @Алёна_2")))
        assertTrue(!hasMention(parseInline("почта@иван")))
        assertTrue(!hasMention(parseInline("$decomposed@иван")))
    }
}
