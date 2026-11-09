package com.cove.chat.data

import com.cove.chat.data.local.BodyCache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BodyCacheTest {
    @Test fun putGetAndKeyIncludesChannelAndNonce() {
        val c = BodyCache()
        c.put(BodyCache.key("ch1", "n1"), "hello")
        assertEquals("hello", c.get(BodyCache.key("ch1", "n1")))
        assertNull(c.get(BodyCache.key("ch2", "n1")))
        assertNull(c.get(BodyCache.key("ch1", "n2"))) // an edit has a new nonce: never a stale body
    }

    @Test fun failurePlaceholdersAndHugeBodiesAreNotKept() {
        val c = BodyCache(maxBodyChars = 10)
        c.put("a", "[encrypted]"); c.put("b", "[decryption failed]"); c.put("c", "x".repeat(11))
        assertEquals(0, c.size())
        assertFalse(c.dirty)
    }

    @Test fun evictsLeastRecentlyUsed() {
        val c = BodyCache(max = 3)
        c.put("1", "a"); c.put("2", "b"); c.put("3", "c")
        c.get("1")
        c.put("4", "d")
        assertNull(c.get("2"))
        assertEquals("a", c.get("1"))
        assertEquals(3, c.size())
    }

    @Test fun jsonRoundTripKeepsEntriesAndClearsDirty() {
        val c = BodyCache()
        c.put("k1", "line\nbreak \"quoted\" 😀"); c.put("k2", "two")
        assertTrue(c.dirty)
        val text = c.toJson()
        assertFalse(c.dirty)
        val d = BodyCache(); d.loadJson(text)
        assertEquals("line\nbreak \"quoted\" 😀", d.get("k1"))
        assertEquals(2, d.size())
    }

    @Test fun malformedFileIsIgnored() {
        val c = BodyCache(); c.loadJson("{not json"); c.loadJson("[1,2]"); c.loadJson("""{"a":5,"b":"ok"}""")
        assertEquals(1, c.size()); assertEquals("ok", c.get("b"))
    }

    @Test fun samePutDoesNotMarkDirtyAgain() {
        val c = BodyCache(); c.put("a", "x"); c.toJson(); c.put("a", "x")
        assertFalse(c.dirty)
    }
}
