package com.cove.chat.emoji

import com.cove.chat.data.model.Pack
import com.cove.chat.data.model.PackItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StickerLogicTest {
    @Test fun encodeParseRoundTrip() {
        val b = StickerLogic.parse(StickerLogic.encode("cove-basics", PackItem("rocket")))!!
        assertEquals(StickerBody("cove-basics", "rocket", ""), b)
        val stored = StickerLogic.parse(StickerLogic.encode("p1", PackItem("s1", fileId = "f9")))!!
        assertEquals("/api/files/f9", StickerLogic.filePath(stored))
        assertNull(StickerLogic.filePath(b))
        assertNull(StickerLogic.filePath(StickerBody("p", "s", "s"))) // file id equal to the sticker id means built-in
    }

    @Test fun parseRejectsBadBodies() {
        for (bad in listOf(null, "", "x", "[]", "{}", """{"pack_id":"a"}""", """{"pack_id":"","sticker_id":"b"}""", """{"pack_id":"a","sticker_id":"b","file_id":3}""", """{"pack_id":"${"a".repeat(129)}","sticker_id":"b"}"""))
            assertNull(bad.toString(), StickerLogic.parse(bad))
    }

    @Test fun shareToken() {
        assertEquals("cove://stickers/abc_1", StickerLogic.encodeShare("abc_1"))
        assertEquals("abc_1", StickerLogic.parseShare("  cove://stickers/abc_1 \n"))
        assertNull(StickerLogic.parseShare("hi cove://stickers/abc"))
        assertNull(StickerLogic.parseShare("cove://stickers/a b"))
        assertNull(StickerLogic.parseShare("cove://stickers/"))
    }

    @Test fun tabsAreServerThenMineThenAdded() {
        val packs = listOf(Pack("a", scope = "user", ownerId = "other"), Pack("b", scope = "builtin"), Pack("c", scope = "user", ownerId = "me"), Pack("d", scope = "server"))
        assertEquals(listOf("b", "d", "c", "a"), StickerLogic.orderedPacks(packs, "me").map { it.id })
    }

    @Test fun initialTabRules() {
        val tabs = listOf("x", "y")
        assertEquals("recent", StickerLogic.initialTab(tabs, "recent", "x", true))
        assertEquals("y", StickerLogic.initialTab(tabs, "y", "x", true))
        assertEquals("recent", StickerLogic.initialTab(tabs, "gone", "x", true))
        assertEquals("x", StickerLogic.initialTab(tabs, "gone", "x", false))
        assertEquals("x", StickerLogic.initialTab(tabs, null, null, false))
        assertNull(StickerLogic.initialTab(emptyList(), null, null, false))
    }

    @Test fun recentsRoundTripDedupeAndPrune() {
        val item = PackItem("s1", fileId = "f", animated = true, url = "/u?v=1", emoji = "🙂")
        val (p, i) = StickerLogic.decodeRecent(StickerLogic.encodeRecent("pk", item))!!
        assertEquals("pk", p); assertEquals(item.copy(bytes = 0), i)
        var l = StickerLogic.addRecent(emptyList(), "pk", item)
        l = StickerLogic.addRecent(l, "pk", PackItem("s2"))
        l = StickerLogic.addRecent(l, "pk", item)
        assertEquals(2, l.size)
        assertEquals(listOf("pk"), StickerLogic.addRecent(l, "pk", item, setOf("pk")).map { it.substringBefore('|') }.distinct())
        assertEquals(emptyList<String>(), StickerLogic.addRecent(l, "pk", item, setOf("other")))
        assertNull(StickerLogic.decodeRecent("broken"))
    }

    @Test fun previewLabel() {
        assertEquals("🙂 Sticker", StickerLogic.previewLabel("Sticker", "🙂"))
        assertEquals("Sticker", StickerLogic.previewLabel("Sticker", null))
    }
}
