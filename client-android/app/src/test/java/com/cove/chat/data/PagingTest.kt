package com.cove.chat.data

import com.cove.chat.data.model.PageResponse
import com.cove.chat.data.model.collectAllPages
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PagingTest {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    @Test fun parsesTheEnvelopeAndIgnoresUnknownFields() {
        val page = json.decodeFromString(serializer<PageResponse<String>>(), """{"items":["a","b"],"next_cursor":"c1","extra":1}""")
        assertEquals(listOf("a", "b"), page.items)
        assertEquals("c1", page.nextCursor)
    }

    @Test fun lastPageHasNoCursorAndNullItemsBecomeEmpty() {
        val last = json.decodeFromString(serializer<PageResponse<String>>(), """{"items":[]}""")
        assertNull(last.nextCursor)
        val nulls = json.decodeFromString(serializer<PageResponse<String>>(), """{"items":null}""")
        assertEquals(emptyList<String>(), nulls.items)
    }

    @Test fun collectAllPagesFollowsCursorsInOrder() = runBlocking {
        val seen = mutableListOf<String?>()
        val pages = mapOf(
            null to PageResponse(listOf(1, 2), "c1"),
            "c1" to PageResponse(listOf(3), "c2"),
            "c2" to PageResponse(listOf(4), ""),
        )
        val all = collectAllPages { cursor -> seen += cursor; pages.getValue(cursor) }
        assertEquals(listOf(1, 2, 3, 4), all)
        assertEquals(listOf(null, "c1", "c2"), seen)
    }

    @Test fun collectAllPagesStopsAtTheSafetyBound() = runBlocking {
        var calls = 0
        val all = collectAllPages(maxPages = 3) { calls++; PageResponse(listOf(1), "again") }
        assertEquals(3, calls)
        assertEquals(listOf(1, 1, 1), all)
    }
}
