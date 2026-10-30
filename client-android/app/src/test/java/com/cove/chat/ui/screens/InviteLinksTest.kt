package com.cove.chat.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InviteLinksTest {
    @Test
    fun findsTheCodeInAnyHostsJoinLink() {
        assertEquals("da316326-6fc71f5e628a82d", InviteLinks.code("http://localhost:5173/join/da316326-6fc71f5e628a82d"))
        assertEquals("abc123", InviteLinks.code("Join us: https://chat.example.com/join/abc123 see you!"))
    }

    @Test
    fun ignoresTextWithoutAJoinLink() {
        assertNull(InviteLinks.code("https://example.com/docs/join-us"))
        assertNull(InviteLinks.code("hello"))
    }

    @Test
    fun usesTheFirstLinkWhenThereAreSeveral() {
        assertEquals("one", InviteLinks.code("/join/one and /join/two"))
    }

    @Test
    fun shareTextNamesTheChannelAndCarriesTheUrl() {
        assertEquals("Join Design on Cove: https://x/join/c", InviteLinks.shareText("Design", "https://x/join/c"))
    }
}
