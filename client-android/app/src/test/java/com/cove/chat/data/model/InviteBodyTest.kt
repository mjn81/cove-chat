package com.cove.chat.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InviteBodyTest {
    @Test
    fun roundTripsTheCode() {
        assertEquals("abc-123", parseInviteCode(encodeInvite("abc-123", "Design", "f1")))
    }

    @Test
    fun writesTheSameFieldNamesAsTheWebClient() {
        val json = encodeInvite("abc", "Design", null)
        assertEquals(true, json.contains("\"code\":\"abc\""))
        assertEquals(true, json.contains("\"name\":\"Design\""))
        assertEquals(false, json.contains("avatar_id"))
    }

    @Test
    fun rejectsBodiesThatAreNotInvites() {
        assertNull(parseInviteCode("hello"))
        assertNull(parseInviteCode("{\"name\":\"x\"}"))
        assertNull(parseInviteCode("{\"code\":\"\"}"))
        assertNull(parseInviteCode("{\"code\":42}"))
        assertNull(parseInviteCode("[]"))
        assertNull(parseInviteCode(""))
    }

    @Test
    fun rejectsCodesThatCouldNotBePartOfAJoinLink() {
        assertNull(parseInviteCode("{\"code\":\"a/b\"}"))
        assertNull(parseInviteCode("{\"code\":\"<script>\"}"))
    }
}
